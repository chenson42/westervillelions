# Receipt alert false positives — Work Log

> **Slug:** `2026-11-05-receipt-alert-false-positives`
> **Surface:** (dashboard) admin (Ledger register, overview guardrail Check 11)
> **Permission(s):** existing `ledger.view` covers the receipt route; no new key
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped (brief) | User confirmed bug from a read-only production query and approved the fix | 2026-11-05 |
| 2 — Architectural review | architect | Skipped | No invariant touched: no schema/migration/permission; reuses the one reimbursement-link helper; approvedAt guards untouched; no durable email claim | 2026-11-05 |
| 3 — Technical design | tech-lead | Skipped | Trivial; root cause below | 2026-11-05 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-11-05 |
| 5 — Verification | full-stack-developer (unit-level) | PASS | See below | 2026-11-05 |
| 6 — Shipped vs intent | — | Note below | — | 2026-11-05 |

## Root cause
`isReceiptMissing()` read only the ledger row's own `receipt_storage_key` / `receipt_waived_at`. Paid reimbursements keep their receipt on `ledger_reimbursements` (NOT NULL), and transfer legs never have one, so both were flagged "No receipt" and could not be waived (approved rows are unwaivable).

## Phase 4 — Implementation (full-stack) — 2026-11-05
**Owner:** full-stack-developer  **Status:** complete

### What changed
- `src/lib/ledger.ts`: `isReceiptMissing` now also requires `transferGroupId == null` and `hasPaidReimbursement === false`.
- `src/lib/ledger-queries.ts`: SQL filter adds `transfer_group_id IS NULL` and `NOT paidReimbursementExists(id)`; Check 11 count looks up paid links only for candidate rows via `listPaidReimbursementTransactionIds`.
- `src/lib/ledger-reimbursement-link.ts`: new `mapPaidReimbursementIdsByTransaction()`.
- Register page `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx`: paid-reimbursement rows show "View receipt" linking to the existing `GET /api/admin/ledger/reimbursements/[id]/receipt` (gate `LEDGER_VIEW`, server-side proxy, no key/URL exposed). Transfer legs already rendered no indicator.
- Tests: `src/lib/ledger.test.ts` (existing cases updated, transfer-leg and paid-reimbursement cases added); new `src/lib/ledger-receipt-missing-parity.test.ts` (SQL filter carries the same three exclusions as the predicate; the map helper).

### Deviations from the design
None. Waive route and all `approvedAt` guards untouched (out of scope).

### Gates
tsc clean; `pnpm lint` 0 errors (2 pre-existing warnings in files not touched); `pnpm test` 346 files / 5970 tests pass; `pnpm build:only` passes.

## Phase 5 — Verification
Unit-level only. Pre-fix, the predicate had no inputs for either exclusion, so a paid-reimbursement row and a transfer leg (expense, no key, no waiver) returned true; the new tests assert false. Dev DB rows were not queried and no browser click-through was done; the register link is untested live. Production is not touched; after deploy the Check 11 count should drop by 3 (2 reimbursements, 1 transfer leg).

## Phase 6 note
Matches the approved intent: signal fixed in JS, SQL, Check 11 and register; no waiver ability added. Follow-up (separate pipeline if wanted): waiving approved rows.

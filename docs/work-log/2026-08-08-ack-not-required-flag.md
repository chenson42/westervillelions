# Ack Not Required Category Flag — Work Log

> **Slug:** `2026-08-08-ack-not-required-flag`
> **Surface:** (dashboard) admin — Ledger (Manage Categories, Donors & Acknowledgments)
> **Permission(s):** existing `LEDGER_MANAGE` covers the PATCH; existing `LEDGER_RECORD` gate on the Acknowledgments queue is unchanged
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phase 2 skipped (rationale below); Phases 1 and 3 briefed inline by the implementer per the treasurer's request rather than run as separate agent passes, since the request already specified the schema decision, the exact production data driving it, and the file to extend

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | full-stack-developer (brief, inline) | Complete | READY FOR DESIGN | 2026-08-08 |
| 2 — Architectural review | — | Skipped | n/a — see rationale | 2026-08-08 |
| 3 — Technical design | full-stack-developer (brief, inline) | Complete | Design + implementer named | 2026-08-08 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-08-08 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (brief)

## VERDICT

READY FOR DESIGN

## ONE-LINE TAKE

> `listPendingAcknowledgments()` queues every Foundation income transaction ≥ $250 for a donor thank-you letter, but 6 of 55 real pending rows come from five recurring categories (race entries, event receipts, a pooled fundraiser deposit, grants, an internal transfer) that will never produce an acknowledgment — a per-category flag lets the treasurer permanently exclude them instead of dismissing the same categories' transactions by hand every year.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Treasurer / admin with `LEDGER_MANAGE` | Flag a category "never needs a donor acknowledgment" via Edit Flags | Rare — five known categories today, occasional new ones |
| Treasurer / admin with `LEDGER_RECORD` | View the Acknowledgments pending queue, now free of the 6 false positives | Per session |

## Flows

**Flow 1 — Flag a category:** Admin opens `/admin/ledger/settings/categories` → Edit flags on an income category on the Foundation → checks "Never needs a donor acknowledgment" → Save Changes (plain save, no confirm — internal-queue-only effect, not public-facing) → toast confirms → category no longer contributes transactions to the Acknowledgments pending list.
- Failure: PATCH 400/403/404 surfaces via toast, same as the existing `countsAsGiving`/`form990Line` paths.

**Flow 2 — View the trimmed queue:** Admin opens Donors & Acknowledgments → pending list now shows only genuine sponsor gifts (49 of the prior 55 rows in production), unaffected transactions unchanged.

## Permissions

- No new `FEATURES` key. PATCH stays gated on `LEDGER_MANAGE` (unchanged). The Acknowledgments queue's own `LEDGER_RECORD` gate for donor PII is unchanged.

## Gaps the Request Didn't Address

- What happens to a transaction already posted to a category before it's flagged, if that transaction is currently mid-acknowledgment (has an unsent ack row)? Resolution: the exclusion checks the *category's current flag*, not the transaction's state at posting time — flagging retroactively drops it from the pending queue immediately, symmetric with how `countsAsGiving` already retroactively changes `/members/impact` reporting for a category's existing transactions. Not treated as a gap requiring special handling — matches the codebase's established retroactive-flag precedent.
- New categories created after this ships default to `ackNotRequired: false` (schema default) — same "queued for review" behavior every category has always had. Not exposed on the create-category dialog (see DECISION-071) — a treasurer flags a new category via Edit Flags if a future recurring non-gift category needs it.

## Out of Scope (confirmed, per the request)

- The acknowledgment model itself (recording vs. sending stays distinct; not touched).
- The $250 threshold (unchanged).
- The five categories' `countsAsGiving` values (unrelated axis; not touched — e.g. "Transfer from Club" was already `countsAsGiving: false` from a prior decision and stays that way).

---

# Phase 2 — Architectural Review — SKIPPED

**Rationale:** No new directory, no new npm dependency, no new permission, no new route. This extends an existing,
already-designed PATCH endpoint (`/api/admin/ledger/categories/[id]`, shipped 2026-08-07 per DECISION-065/066) with
one more optional boolean field, following the exact pattern `countsAsGiving` already established end-to-end (schema
column → migration → query filter → `CategoryUpdatePatch` → `updateCategory` diff/audit → route validation → dialog
checkbox). No invariant is touched or reinterpreted. Documented here per CLAUDE.md's "no silent skips" rule.

---

# Phase 3 — Technical Design (brief)

## Summary

Add `ledgerCategories.ackNotRequired` (boolean, default false) — a second, independent axis from `countsAsGiving`
(outbound-giving-totals vs. inbound-acknowledgment-queue). Exclude flagged categories from
`listPendingAcknowledgments()` via a `LEFT JOIN` on `ledgerCategories` and an `OR(category IS NULL, ackNotRequired =
false)` admission condition (uncategorized income stays admitted — nothing to check the flag on). Extend the
existing `PATCH /api/admin/ledger/categories/[id]` contract (already general-purpose per DECISION-065/066) rather
than adding a new route. Extend `CategoryFlagsDialog` with a conditionally-rendered checkbox, gated on
`category.flow === "income" && entityDonationsDeductible` — the only scope where the flag has any effect. See
DECISION-071 for the two implementation-level calls (no server-side scope block; not exposed at category creation).

## Permissions

- No new permission key. Existing `LEDGER_MANAGE` (PATCH) and `LEDGER_RECORD` (donor PII on the queue) apply unchanged.

## API Contract

- `PATCH /api/admin/ledger/categories/[id]` (extended, not new) — body may now include `ackNotRequired?: boolean`
  alongside `name` / `countsAsGiving` / `form990Line` / `isActive`. Same validation shape (400 if present and not a
  boolean), same audit-log flow (`category_flags_updated` when it's the only field changed alongside/with
  `countsAsGiving`/`form990Line`; the existing name/isActive precedence rule is untouched).

## Data Model

- `ledger_categories.ack_not_required` — `boolean NOT NULL DEFAULT false`. Migration `drizzle/migrations/0075_ledger_category_ack_not_required.sql`, additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` plus a guarded backfill `UPDATE` naming the five known categories, scoped to `donations_deductible = true AND flow = 'income'`.

## Component / Page Plan

- Modified: `CategoryFlagsDialog` (new checkbox + `entityDonationsDeductible` prop), `CategoryList` (passes the new
  prop from `activeEntity.donationsDeductible`), `EntityCategoryData`/`AdminCategoryRow` (new fields), the categories
  admin page (maps the new fields from `getEntities()`/`toCategoryDTO()`).
- No new pages, no new dialogs.

## Implementation Order

1. Schema column + migration.
2. `listPendingAcknowledgments()` exclusion join.
3. `CategoryUpdatePatch` / `updateCategory` / `toCategoryDTO` / `CategoryImpact` plumbing.
4. PATCH route validation.
5. UI types (`ledger-category-ui.ts`) + page mapping + dialog checkbox.
6. Unit tests (query exclusion shape, audit-trail flags-only + no-op cases, PATCH validation + 200).

## Edge Cases & Risks

- A category shared by name across both entities ("Pancake Breakfast" exists under both Club and Foundation) — the
  backfill's `JOIN ledger_entities ... WHERE donations_deductible = true` correctly touches only the Foundation row;
  verified against dev data below.
- Exact category name text includes an en dash (`–`, U+2013) in "Rudolph Run – Registration/Entry Fees" — copied
  byte-for-byte from a `psql` query against the dev DB rather than typed, to avoid a silent zero-row backfill.

## Implementer

full-stack-developer (this document)

---

# Phase 4 — Implementation

## Files Modified

- `src/lib/db/schema.ts` — added `ledgerCategories.ackNotRequired` column, commented to distinguish from `countsAsGiving`.
- `drizzle/migrations/0075_ledger_category_ack_not_required.sql` — new migration: additive column + guarded backfill for the 5 named categories, scoped to donations-deductible entities' income categories.
- `src/lib/ledger-queries.ts` — `listPendingAcknowledgments()`: added `LEFT JOIN ledgerCategories` + `OR(isNull(category.id), ackNotRequired = false)` admission condition; updated doc comment.
- `src/lib/ledger-category-queries.ts` — `CategoryUpdatePatch.ackNotRequired`, `updateCategory()` before/after diff for it, `toCategoryDTO()` includes it, `CategoryImpact.category.ackNotRequired` for parity with the other flag fields.
- `src/app/api/admin/ledger/categories/[id]/route.ts` — validates `ackNotRequired` (400 if present and non-boolean), passes it through to `updateCategory()`; doc comment updated with the new validation step and the "no server-side scope block" note (DECISION-071).
- `src/lib/ledger-category-ui.ts` — `AdminCategoryRow.ackNotRequired`; `EntityCategoryData.donationsDeductible` (new entity-level field the dialog needs to gate the checkbox).
- `src/app/(dashboard)/admin/ledger/settings/categories/page.tsx` — maps `entity.donationsDeductible` and `dto.ackNotRequired` into the client payload.
- `src/components/admin/ledger/category-list.tsx` — passes `entityDonationsDeductible={activeEntity.donationsDeductible}` to `CategoryFlagsDialog`.
- `src/components/admin/ledger/category-flags-dialog.tsx` — new `entityDonationsDeductible` prop, `ackNotRequired` state, conditionally-rendered checkbox (`category.flow === "income" && entityDonationsDeductible`), included in the plain-save patch (no `ConfirmDialog` — no public-facing/retroactive-dollar effect, unlike `countsAsGiving`).
- Test files updated for the new required field on existing fixtures: `src/lib/ledger-category-ui.test.ts`, `src/lib/ledger-category-queries.test.ts`, `src/app/api/admin/ledger/categories/[id]/route.test.ts`.
- `docs/decisions.md` — added DECISION-071 (UI-gated not server-blocked; not exposed at category creation).

## Schema Changes

- `ledger_categories.ack_not_required boolean NOT NULL DEFAULT false`.
- Migration: `drizzle/migrations/0075_ledger_category_ack_not_required.sql`.
- **Idempotency verification (against the DEV database, `DATABASE_URL` in `.env.local` — never `PROD_DATABASE_URL`):**
  ran `pnpm db:migrate` twice in a row.
  - Run 1: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` applied fresh; backfill `UPDATE` flagged exactly 5 rows (verified below).
  - Run 2: Postgres itself emitted `NOTICE: column "ack_not_required" ... already exists, skipping` for the `ALTER
    TABLE`; the backfill `UPDATE`'s `WHERE ... AND ack_not_required IS DISTINCT FROM true` guard made it a no-op
    (re-checked via `psql` — same 5 rows, same values, nothing changed). `pnpm db:migrate` reported `✅ Migrations
    completed successfully` both times.
  - Confirmed via direct query against dev data that exactly 5 categories were flagged (Foundation-only, income-only:
    "Fundraising events", "Grants received", "Pancake Breakfast", "Rudolph Run – Registration/Entry Fees", "Transfer
    from Club") and that the sibling Club-side "Pancake Breakfast"/"Rudolph Run" categories and the other two
    Foundation Rudolph Run sub-categories ("Sponsorships & Donations", "Day-of / Merchandise" — genuine gifts/sales,
    correctly NOT flagged) were untouched.
  - Confirmed against real dev transaction data: `listPendingAcknowledgments()`'s WHERE-clause equivalent now
    excludes exactly 6 previously-pending rows (matching the treasurer's report) and the remaining pending count is
    49 (also matching).

## Implementer Notes

- Followed the `countsAsGiving` precedent end-to-end (same file, same function, same route) rather than introducing a
  new pattern — this is a one-column, one-condition, one-checkbox feature riding an already-shipped general-purpose
  PATCH contract.
- Decided (DECISION-071) not to add a server-side restriction on which category `ackNotRequired` can be set on, and
  not to expose it in `CategoryCreateDialog` — see that decision entry for the reasoning.
- The checkbox saves plainly (no `<ConfirmDialog>`), unlike `countsAsGiving` — this flag has no public-facing or
  retroactive-dollar-total effect, so it doesn't warrant the same weight; it's grouped with the plain-save
  `form990Line` field instead.
- No new `FEATURES` key, no new env var, no new route.

## Tests Written (Phase 3's named minimum, all delivered by this implementer)

1. **`src/lib/ledger-queries.test.ts`** — `listPendingAcknowledgments — ack_not_required exclusion`: asserts the
   compiled WHERE clause (via `PgDialect().sqlToQuery()`, mirroring the existing `getFundReport asOfDate bounding`
   pattern in the same file) references `ledger_categories` and `ack_not_required`, and that `false` appears in the
   bound params — proving the exclusion condition is wired into the query. (The hermetic `db` mock in this file only
   *captures* WHERE conditions rather than evaluating them against canned rows — a full "flagged category's rows are
   absent, unflagged remain" behavioral test would need a real database round-trip, which this suite deliberately
   doesn't do; the SQL-shape assertion is the established precedent for proving filter logic here.) Real-data
   behavioral confirmation of "flagged excluded / unflagged remain" was done directly against the dev DB (6 excluded,
   49 remaining — see Schema Changes above).
2. **`src/lib/ledger-category-queries.test.ts`** — two new cases in `updateCategory — audit trail`: (a) an
   `ackNotRequired`-only change writes a `category_flags_updated` audit row with only that field in before/after,
   and issues the expected UPDATE; (b) a no-op `ackNotRequired` patch (same value) writes no audit row and issues no
   UPDATE — mirrors the existing no-op-rename test's shape, extended to this field ("the migration backfill preserves
   existing behaviour" reframed at the query layer: an unset/unchanged flag is provably a no-write no-op).
3. **`src/app/api/admin/ledger/categories/[id]/route.test.ts`** — two new cases: 400 when `ackNotRequired` is present
   and not a boolean; 200 on a valid `ackNotRequired` patch, asserting `updateCategory` is called with exactly
   `{ ackNotRequired: true }` and the response DTO carries it through — the round-trip-through-PATCH test named in
   the brief.
4. Existing-fixture updates (not new test cases, but required for the new required field): `ledger-category-ui.test.ts`'s `row()` factory, `ledger-category-queries.test.ts`'s `category()` factory, and the `[id]/route.test.ts` mock `toCategoryDTO`/`EXISTING_CATEGORY`.

## Gates

- `pnpm exec tsc --noEmit`: **PASS** (clean, no output).
- `pnpm test`: **PASS** — 1127 passed (54 files), up from the 1122 baseline by the 5 new test cases above (1 query-shape test + 2 audit-trail tests + 2 PATCH-route tests); zero regressions.
- `pnpm build:only`: **PASS** — production build completed, full route manifest emitted, no errors.

---

# Phase 5 — Verification (qa)

Pending — next agent.

---

# Phase 6 — Shipped vs Intent (analyst)

Pending — next agent, after Phase 5 PASS.

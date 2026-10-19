# Itemized Sweep Increment 1: Public Funds Rename, Category Mirrors, Donor on Public Funds Income — Work Log

> **Slug:** `2026-10-17-itemized-sweep-inc1-rename-and-mirrors`
> **Parent:** `docs/work-log/2026-10-16-itemized-sweep-public-funds.md` (B-172, Itemized sweep and Public Funds; Phases 1 to 3 live there)
> **Reserved IDs:** DECISION-126 and DECISION-127 (Proposed); backlog B-190 to B-197 filed (Inc 1 delivers none of them); migration number re-derived at Phase 4 start; B-198 and B-199 filed at release (Phase 6 follow-ups); next free id is B-200
> **Surface:** (dashboard) admin: The Ledger (register, categories, transaction form, donors, Treasury guide)
> **Permission(s):** no new `FEATURES` key (existing `ledger.record`, `ledger.manage`, `ledger.approve`, `ledger.view`)
> **Estimated complexity:** medium-large
> **Pipeline mode:** Full, increment of a multi-increment feature. Phases 1 and 2 done in parent; Phase 3 designed in parent, Increment 1
> **Migration:** Yes: one (placeholder `0115`): `ledger_categories.mirrors_category_id`, the one-shot mirror seed, the fresh-install fund literal in `0044`
> **Phase 4/5 environment:** `isolation: "worktree"` with its own Neon dev branch and its own `.env.local` copy (pipeline rule 5). Pass the branch id POSITIONALLY to `neonctl connection-string` and compare the host before any write (the `--branch-id` flag silently returns production).
> **Depends on:** None; ships alone (the lump sweep keeps working).
> **Release:** v1.99.0 (2026-10-17). Release notes written at `docs/release-notes/v1.99.md`, `package.json` bumped to 1.99.0 in the main tree, DECISION-127 promoted to Resolved for Inc 1, CLAUDE.md bullet added, backlog B-198 and B-199 filed (next free id **B-200**). **Awaiting the user's approval to commit and push; nothing is committed.** The orchestrator runs `/pre-push` on the merged tree. Post-deploy: the user renames the fund in Edit fund at `/admin/ledger/activity`.
> **Pre-push record (orchestrator, 2026-10-18, combined main tree, uncommitted, HEAD 014f7f6 + 91 entries):** tsc clean; lint 0 errors / 1 pre-existing warning; unit 313 files / 5190 tests green; `pnpm build:only` passes with every ledger route present; `pnpm audit --prod --audit-level=high` exit 0 (advisory: `uuid` moderate GHSA-w5hq-g745-h8pq, `@babel/core` low GHSA-4x5r-pxfx-6jf8); personal-data sweep ran (exit 0, 2 hits, both example domains), no env files tracked or staged; migration 0115 replayed on the dev database (marker 1 row, 2 links) and its one INSERT sits inside the marker guard; `drizzle-kit push` not run locally (B-165 prompts; the deploy runs it with `--force`). **Full e2e, serial on :3000 against the dev database:** 330 passed, 18 failed, 2 skipped, 103 did not run (serial-group cascades), 1.8 h. Classification: 5 White Cane failures are the live-window Zeffy iframe holding `page.goto`'s `load` wait (spec and page untouched by this release; filed as B-198 item 4); 1 category-management failure was a 10 s read-after-write poll under Neon latency whose timeout left the fixture flipped, so the first re-run failed its precondition; after restoring the dev-database fixture the spec passed 15/15 (B-198 item 5); the remaining 12 are `page.goto` / `waitForURL` timeouts, closed-browser cascades and two `CONNECT_TIMEOUT`/`ECONNRESET` query failures spread across Santa's Workshop, social requests, club files, write-in signups, wall-clock, approvals cosign, ledger search, budget-committee gate and budget-line link; the ledger ones among them (budget-committee gate, ledger search, budget-line link) and the wall-clock control passed on re-run with no code change, and the cosign spec passed in qa's Phase 5 re-verification on the identical tree. No failure traced to this diff. Ready to push pending the user's approval to commit.
> **Deploy record (orchestrator, 2026-10-18):** pushed to `main` as `540b571` (92 files, 5759+/311-); Vercel GitHub deployment 7160138486 for that SHA reports `success` (20:17 UTC); production read afterwards: `ledger_categories.mirrors_category_id` present, `category_mirrors_seeded` marker 1 row, Club `Public donations` and `White Cane` linked to their Foundation counterparts, `Zeffy Donations` unlinked (as predicted by the 2026-10-17 production facts). Both worktrees (`itemized-sweep-inc1`, verified byte-identical to the commit, and the long-merged Santa's Workshop one) and their branches were removed locally. Neon branch `br-hidden-bird-amm4r97n` (`feature/itemized-sweep`) is still to be deleted, pending the user's say-so.
>
> **Production writes (orchestrator, 2026-10-18, after the deploy), at the user's instruction in that turn: "can you just do those two actions for me?"** (the two post-deploy steps named in the release notes: rename the fund; reactivate Public Funds categories). The app's own routes were not reachable without signing in as the user, so the writes went in as one `psql` transaction on `PROD_DATABASE_URL` (host `ep-rough-smoke` compared before running), inside a `DO` block that raises on any row count other than the expected one, writing the same `ledger_audit_log` rows the app writes (`fund_updated` via `recordLedgerAuditNote()`'s shape; `category_reactivated` via `updateCategory()`'s shape, `details` carrying a provenance sentence instead of the app's `null`). Actor = the user's own `users.id`. Statements and counts:
> 1. `UPDATE ledger_funds SET name = 'Public Funds', updated_at = now() WHERE id = 'bc13669d-…6166' AND name = 'Activity Fund'` → 1 row (before: 1 Club `activity` fund named `Activity Fund`; after: named `Public Funds`).
> 2. `INSERT INTO ledger_audit_log (… 'fund_updated' …)` with `before {"fundId","name":"Activity Fund"}`, `after {… "name":"Public Funds"}` → 1 row.
> 3. `UPDATE ledger_categories SET is_active = true, updated_at = now() WHERE id IN (Public donations 13889f70-…, White Cane 25e2244d-…, Zeffy Donations d5a6a7cf-…) AND is_active = false` → 3 rows (before: 0 of 14 Club `activity` categories active; after: 3 active, 11 inactive).
> 4. `INSERT INTO ledger_audit_log (… 'category_reactivated', target_category_id …)` one per category, `before {"isActive":false}`, `after {"isActive":true}` → 3 rows.
> Verified inside the transaction and again read-only after `COMMIT`. Scope deliberately limited to the three income categories the release notes name; the other eleven Club Public Funds categories (4 income: Interest, Pancake Breakfast, Rudolph Run, Sponsorships; 7 expense) stay inactive until the treasurer names the ones in use (B-199). The seeded counterparts were not touched. No personal data read or written.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Done in parent (see 2026-10-16-itemized-sweep-public-funds.md) | READY WITH NOTES | 2026-10-16 |
| 2 — Architectural review | architect | Done in parent (see 2026-10-16-itemized-sweep-public-funds.md) | Approved with suggestions | 2026-10-17 |
| 3 — Technical design | tech-lead | Done in parent (see 2026-10-16-itemized-sweep-public-funds.md, "Phase 3 — Technical Design", Increment 1) | Design complete | 2026-10-17 |
| 4 — Implementation | database-admin → api-developer → ux-developer (specialist split) | Complete (loop-back fixed); qa re-verify next | — | 2026-10-17 |
| 5 — Verification | qa | Complete (re-verified after loop-back; first run FAIL on the Budgeting "Activity" badge, fixed) | PASS | 2026-10-17 |
| 6 — Shipped vs intent | analyst | Complete for Increment 1 only (standalone-deploy review); the B-172-wide Phase 6 remains after Inc 2b | SHIP WITH NOTES (Inc 1) | 2026-10-17 |

---

# Phases 1 to 3

**Phase 1 (analyst):** Done in parent (see `2026-10-16-itemized-sweep-public-funds.md`, "Phase 1 — Functional Refinement").
**Phase 2 (architect):** Done in parent (see `2026-10-16-itemized-sweep-public-funds.md`, "Phase 2 — Architectural Review").
**Phase 3 (tech-lead):** the design for this increment is in the parent's "Phase 3 — Technical Design", Increment 1; read "Rulings that differ from Phase 1/2 (read first)" before anything else. DECISION-126 and DECISION-127 are in `docs/decisions.md` (Proposed; promoted at Phase 6).

## Scope of this increment

Rename through one labels module (`ledger-fund-labels.ts`, `ledger-fund-labels-queries.ts`), fund descriptors carrying `name` in the pure policies, label-threaded warning functions, the scan test for the literal "Activity". Category mirrors (`mirrors_category_id`, `checkCategoryMirror`, PATCH/POST/impact/merge changes, read-only flags, the counterpart UI). `donorId` on create for Public Funds and Foundation income with the shared donor panel and picker, the Foundation-bound hint, and the donor-page total fix. The per-row closeout marker is NOT in this increment (Inc 2a). `Transfer to Foundation` is NOT seeded here (Inc 2a). The user renames the fund in the fund editor after deploy.

## Start-of-Phase-4 checklist

- Re-derive the next free migration number (`ls drizzle/migrations/*.sql | sort | tail -3`); the tail was `0114` on 2026-10-17 and the parent's `0115`/`0116` are placeholders.
- Read the parent's Phase 3 Increment 1 test list: every unit test named there is written and passing before Phase 5; `default-role-bundles.test.ts` is run, not edited.
- Scratch space: `<scratchpad>/<pipeline-slug>/`; never kill or restart the `:3000` dev server (ask the orchestrator); no agent writes the production database (Workflow Rule 10).
- Keep every file free of personal data: category and fund names only, placeholder amounts, `example.invalid`.
- Record "Deviations from the design" at the end of Phase 4, routed by size per the scope-routing rule in CLAUDE.md.

---

# Phase 4 — Implementation

## Files Created

- `drizzle/migrations/0115_ledger_category_mirrors.sql` — column, FK, one-shot mirror seed (number re-derived: tail was 0114).
- `src/lib/ledger-category-mirror-schema.test.ts` — 9 tests (migration scan + schema shape + 0044 literal).

## Files Modified

- `src/lib/db/schema.ts` — `ledgerCategories.mirrorsCategoryId` + `foreignKey` `ledger_categories_mirror_fk` (ON DELETE SET NULL), `foreignKey` import, `ledgerAuditLog` action vocabulary (`category_mirror_changed`, `category_mirrors_seeded`) and the both-targets-null note.
- `drizzle/migrations/0044_ledger_books.sql` — activity fund seed literal `'Public Funds'` (still `WHERE NOT EXISTS`; renames no existing row).

## Schema Changes

- `ledger_categories.mirrors_category_id uuid` NULL, no default, self-FK `ledger_categories_mirror_fk` ON DELETE SET NULL, no index (per design).
- Donor on Public Funds income: no schema change (`ledger_transactions.donor_id` exists).
- Migration: `drizzle/migrations/0115_ledger_category_mirrors.sql`.

## Implementer Notes

- Target verified as `ep-silent-silence-…` (the pipeline branch) before any write.
- **Seed guard:** one `DO` block; runs only if no `ledger_audit_log` row has `action='category_mirrors_seeded'`; links Club `activity` income categories named (case-insensitive) `Public donations` / `White Cane`, only where the column is NULL, to the active Foundation `charitable` income category of the same lower-cased name (lowest `sort_order`, then `id`); inserts the marker in the same block (also when a pair is missing). Seeded on the branch: 2 links, 1 marker row.
- **Idempotence proof:** `pnpm db:migrate` run twice (plus a third time in the replay check); each ended "Migrations completed successfully" with only existing-object NOTICEs from earlier migrations. State after run 1: 2 links, 1 marker; after run 2: unchanged.
- **S1 replay check:** cleared both links on the branch with an UPDATE, re-ran `pnpm db:migrate`: links stayed 0, marker still 1 (the seed did not re-link).
- `pnpm db:push` not run: the design does not require it (migration and schema.ts agree; FK name equal in both).
- Tests: `pnpm exec tsc --noEmit` clean; `pnpm test` 304 files / 5060 tests pass (includes the new 9; `default-role-bundles.test.ts` untouched and green).

### Deviations from the design
None.

### Handoff to api-developer
`ledgerCategories.mirrorsCategoryId` is available on the Drizzle type; the audit actions are `category_mirror_changed` and `category_mirrors_seeded` (the latter never listed by a reader). Branch dev data: Public donations and White Cane are mirrored (Zeffy Donations, Interest, Pancake Breakfast, Rudolph Run, Sponsorships are not); the replay check left both links cleared in the branch, so re-link them from the category screen if a live check needs them.

## Phase 4 — Implementation (API) — 2026-10-17

**Owner:** api-developer
**Status:** complete (server step); ux-developer next

### Summary
The rename plumbing, the category counterpart (mirror) server side and `donorId` on create are built and unit-tested. `tsc` clean, `pnpm lint` 0 errors (1 pre-existing warning, `budget-context-panel.tsx:114`, not this diff), `pnpm test` 308 files / 5150 tests pass. Live check on the pipeline Neon branch (host `ep-silent-silence-…` confirmed before any write) re-linked both seeded pairs through the PATCH route.

### Files Created
- `src/lib/ledger-fund-labels.ts` (client-safe: `FundKind`, `FundLabels`, `DEFAULT_FUND_LABELS`, `buildFundLabels`, `fundLabel`, `refName`, `fundKindBadge`, `fundExplainer`); `src/lib/ledger-fund-labels-queries.ts` (`getFundLabels()`, React `cache()`).
- `src/lib/ledger-category-mirror.ts` (client-safe carrier: `checkCategoryMirror`, `mirroredFlagEditBlocked`, `isPublicFundsIncome`, `MirrorHint`/`describeMirrorHint`, `MirrorProjection`, `MirrorErrorCode`, exhaustive `MIRROR_COPY` as functions of `FundLabels`, `mirrorErrorMessage`, `mirrorHintCopy` with a `never` switch).
- `src/lib/ledger-donor-giving.ts` (`sumDeductibleGiving`).
- Tests: `ledger-fund-labels.test.ts`, `ledger-category-mirror.test.ts`, `ledger-donor-giving.test.ts`, `fund-name-literal-scan.test.ts`.

### Files Modified
- Policies and copy: `ledger-transfer-policy.ts` (`FundRef.name?`, reasons from `refName()`), `ledger-fund-move-policy.ts` (same), `ledger-correction.ts` (the four Activity-bearing constants became `ratchetWarning`, `agedPublicFundWarning`, `crossEntityRatchetReceiptSent`, `crossEntityRatchetNoReceipt`, functions of `FundLabels`; `buildMoveWarnings` takes optional `labels`), `ledger.ts` (`GuardrailsInput.fundLabels?`, firewall and admin-public-income flag text, the negative-balance title and detail no longer print the raw kind; `ACK_MIN_CENTS`), `ledger-fund-move-queries.ts` (names into `FundRef`, labels from `allFunds` into `buildMoveWarnings`), `ledger-queries.ts` (`fundLabels` into `guardrails()`, `ACK_MIN_CENTS` in `listPendingAcknowledgments`, `donorExists`, `getDonor` rows carry `entityDonationsDeductible`).
- `ledger-category-queries.ts`: `toCategoryDTO(category, mirror?)` adds `mirrorsCategoryId` and `mirror` (read-only projection of the counterpart's `countsAsGiving`, `ackNotRequired`, `form990Line`, name, active), `loadMirrorProjections`, `validateMirrorWrite`, `updateCategory` takes `mirrorsCategoryId` (audit `category_mirror_changed`, ids only, precedence name > isActive > mirror > flags), `getCategoryImpact` gains `mirror` and `mirroredBy` (names capped at 10), `mergeCategories` gains 409 `mirror_conflict`, re-points counterpart links on confirm, `mirrorsRepointed` in both responses.
- Routes: `categories/route.ts` (GET list carries projections; POST accepts `mirrorsCategoryId`, `ledger.manage` plain-language 403 before any lookup), `categories/[id]/route.ts` (PATCH), `categories/merge/route.ts`, `transactions/route.ts` (`donorId` on create; fund names into `checkTransferDirection`), `transactions/[id]/route.ts` (donor check moved onto `donorExists`; its 400 "Donor not found" is unchanged).
- `ledger-category-ui.ts` (`AdminCategoryRow.mirrorsCategoryId`, `mirrorsOf()`); compile-fix edits to UI-side files: `settings/categories/page.tsx` (passes `mirrorsCategoryId`), `move-transaction-dialog.test.tsx` and `donor-detail-client.test.tsx` (fixtures only).
- Existing tests extended or adjusted: `ledger-transfer-policy.test.ts`, `ledger-fund-move-policy.test.ts`, `ledger-correction.test.ts`, `ledger.test.ts`, `ledger-queries.test.ts`, `ledger-category-queries.test.ts`, `ledger-category-ui.test.ts`, `categories/route.test.ts`, `categories/[id]/route.test.ts`, `transactions/route.test.ts`.

### API contracts (for ux-developer)
- `PATCH /api/admin/ledger/categories/[id]` (`ledger.manage`): body `mirrorsCategoryId?: string | null`. Errors carry `{ error, code }`: 400 `invalid_mirror`, 404 `mirror_target_not_found`, 400 `subject_not_public_income` | `target_not_foundation_income` | `target_inactive` | `target_is_self`, 400 `mirrored_flag_read_only`. 200 returns the DTO with `mirrorsCategoryId` and `mirror: MirrorProjection | null`. Codes and copy come from `ledger-category-mirror.ts` (`MirrorErrorCode`, `mirrorErrorMessage(code, labels)`).
- `POST /api/admin/ledger/categories`: optional `mirrorsCategoryId`; budget.edit-only callers get a 403 before any lookup. Response now includes `mirrorsCategoryId`.
- `GET /api/admin/ledger/categories`: each DTO has `mirrorsCategoryId` and `mirror`.
- `GET …/categories/[id]/impact`: `category.mirrorsCategoryId`, `mirror: { id, name, isActive, entityName } | null`, `mirroredBy: { count, names[] }`.
- `POST …/categories/merge`: 409 `{ error, code: 'mirror_conflict' }`; plan and apply responses add `mirrorsRepointed: number`.
- `POST /api/admin/ledger/transactions` (`ledger.record`): `donorId?: string | null`; 400 `donor_not_applicable` (expense, or fund kind other than `activity`/`charitable`), 400 for a non-UUID, 404 `donor_not_found`. 201 body unchanged.
- `getDonor()`: each `givingHistory` row has `entityDonationsDeductible`. The client change at `donor-detail-client.tsx:81` is the ux-developer's: `sumDeductibleGiving(rows.map(r => ({ amountCents: r.txn.amountCents, entityDonationsDeductible: r.entityDonationsDeductible })))`.
- Hint fact: no DTO field was needed. The form computes the hint client-side with `describeMirrorHint(category, mirror, amountCents)` from the category DTO's `mirror` projection (the category list the form already loads must come from `GET categories` or `listCategoriesForAdmin` + `loadMirrorProjections`).
- Consumers grepped for the widened/removed members: `RATCHET_WARNING`, `AGED_PUBLIC_FUND_WARNING`, `CROSS_ENTITY_RATCHET_*` (only the move dialog test imported them; no component did, the dialog renders server warnings), `AdminCategoryRow` (page + tests), `givingHistory` (donor page + test), `CategoryImpact` / merge responses (no component reads the new fields yet). No `x === "a" ? … : …` over a widened union was affected.

### Scan test (`src/lib/fund-name-literal-scan.test.ts`)
Fails on capital-A `Activity` (comments stripped) in the ledger lib, ledger components, ledger pages and ledger API routes, and on `activity fund(s)` case-insensitively on member surfaces; negative control included; a stale-allowlist test forces entries out as files are cleaned. Allowlist left for ux-developer (each with a comment in the file): `app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` (`{fund.kind} fund`), `components/admin/ledger/ledger-settings-form.tsx`, `components/admin/ledger/transaction-form.tsx`, `components/admin/ledger/guide/settings-section.tsx`, `books-register-section.tsx`, `zeffy-fund-routing-section.tsx`, `budgeting-section.tsx`, `guardrails-section.tsx`. Not caught by the scan, still UI-side: `src/app/members/impact/page.tsx:89` says "Activity and Charitable" (member page, capital A only; the design bans only `activity fund` there; flag for the ux-developer to decide).

### Tests named in the design (all written, passing)
`ledger-fund-labels.test.ts` (8); `ledger-transfer-policy.test.ts` and `ledger-fund-move-policy.test.ts` extended, mutual-exclusion test and every direction assertion unchanged and green; `ledger-correction.test.ts` +3 (custom name never prints Activity); `ledger.test.ts` +1 (firewall flag reads the labels); `ledger-category-mirror.test.ts` (22: full `checkCategoryMirror` matrix, `mirroredFlagEditBlocked`, every `describeMirrorHint` state, `MIRROR_COPY` coverage); `ledger-category-queries.test.ts` +17 (set/clear/no-op/precedence/DTO, impact `mirror`+`mirroredBy`, merge conflict/re-point/plan, `validateMirrorWrite`); `categories/route.test.ts` +5 and `categories/[id]/route.test.ts` +8 (403, each code, 404, flag guard, POST stores); `transactions/route.test.ts` +7 (`donorId`); `ledger-queries.test.ts` +3 (`getDonor` flag, `donorExists`, `listPendingAcknowledgments` binds `ACK_MIN_CENTS`); `ledger-donor-giving.test.ts` (2); `ledger-category-ui.test.ts` +2 (`mirrorsOf`); `fund-name-literal-scan.test.ts` (6). `default-role-bundles.test.ts` and `admin-page-feature-gates.test.ts` run, not edited, green.

### Live check (dev server from this worktree on :3101, stopped afterwards; :3000 untouched)
Signed in with the e2e admin through the credentials form. `PATCH Public donations` to the Foundation `Public donations`: 200 with `mirror` projection. `PATCH White Cane` to the Foundation `White Cane`: 200 (its projection shows `form990Line: null`, as V5 predicted). Refusals: changing `countsAsGiving` on a mirrored category 400 `mirrored_flag_read_only` (message used the stored fund name "Activity Fund", proving the rename plumbing); self 400 `target_is_self`; Club target 400 `target_not_foundation_income`; unknown id 404 `mirror_target_not_found`; malformed 400 `invalid_mirror`. Impact of the Foundation `Public donations`: `mirroredBy` count 1. Branch audit log now holds 2 `category_mirror_changed` rows; both links are in place on the branch.

### Deviations from the design
- Audit rows for the category actions are written with the existing `tx.insert(ledgerAuditLog)` inside `updateCategory` (same pattern as `category_renamed`), not `recordLedgerAudit()`: that helper writes `targetCategoryId: null` and only the correction vocabulary, while these actions need `targetCategoryId`. No new write path.
- `mirror` projection is also on the list and PATCH DTO (not only the impact response), so the category screen has the Foundation's flags without a second call (about 20 lines; absorbed).
- The category screen can also use `mirrorsOf(rows, row)` over the rows it already loads for both entities.
- A `Transfer to Foundation` category, `recordLedgerAudit` changes and any new route: none (ruling 1 stands).

### Open questions / handoff notes
- Next: ux-developer (UI list in the Phase 3 Component Plan, then clear the scan allowlist to zero). Pass `labels` (from `getFundLabels()` on pages, `buildFundLabels(funds)` where fund rows are in hand) into the guide sections and `transaction-form`.
- Concurrent, not this diff: lint warning `src/components/admin/ledger/budget-context-panel.tsx:114` (unused eslint-disable directive).
- Nothing goes back to Phase 3.

## Phase 4 — Implementation (UI) — 2026-10-17

**Owner:** ux-developer
**Status:** complete; qa next

### Summary
Every ledger surface now reads the stored fund name; the scan allowlist is empty. The category screen can set and clear a Foundation counterpart and shows its flags read-only; the transaction form takes a donor on new Public Funds and Foundation income with the Foundation-bound hint; the donor page counts Foundation gifts only. `tsc` clean, `pnpm lint` 0 errors (1 warning, `budget-context-panel.tsx:114`, concurrent, not this diff), `pnpm test` 312 files / 5184 tests pass.

### Files Created
- `src/components/admin/ledger/donor-search-panel.tsx` (extracted from `link-donor-dialog.tsx`), `donor-picker-field.tsx`, `foundation-bound-hint.tsx`, `category-mirror-dialog.tsx`.
- Tests: `foundation-bound-hint.test.tsx` (6), `donor-picker-field.test.tsx` (5), `transaction-form-donor.test.tsx` (4), `guide/treasury-guide-labels.test.tsx` (13).

### Files Modified
- Fund names: `[fundSlug]/page.tsx`, `ledger-settings-form.tsx` + `settings/page.tsx`, `transaction-form.tsx` (labels built from the funds it already holds, no new prop), the five guide sections + `guide/page.tsx` (`labels` prop; `getGuardrailRows(labels)`), `ledger-entity-detail.tsx`, `reports/page.tsx`, `pay-reimbursement-dialog.tsx` (`fundKindBadge`), `src/lib/ledger-fund-labels.ts` (`fundExplainer(kind, labels?)`), `src/app/members/impact/page.tsx`.
- Categories: `category-list.tsx` (counterpart lines both directions, a Counterpart action on Club Public Funds income rows, `labels` prop), `category-flags-dialog.tsx` (disabled flags with the counterpart's values and note, Foundation's 990 line as information), `category-deactivate-confirm.tsx` (`mirroredBy` warning), `category-merge-dialog.tsx` (`mirrorsRepointed` in preview and toast; the 409 `mirror_conflict` message already shows verbatim), `settings/categories/page.tsx`, `ledger-category-ui.ts` (`mirrorTargetOptions`).
- Donor: `transaction-form.tsx`, `transaction-form-dialog.tsx`, `ledger-entity-detail.tsx`, `ledger/page.tsx` and `[fundSlug]/page.tsx` (`mirrorHints` from `loadMirrorProjections`), `txn-donor-actions.tsx` (`mode`), `link-donor-dialog.tsx` (onto the panel), `donor-detail-client.tsx` (`sumDeductibleGiving`, row label, no Acknowledge on a non-deductible row).
- Tests extended: `txn-donor-actions.test.tsx`, `donor-detail-client.test.tsx`, `ledger-category-ui.test.ts`, `ledger-fund-labels.test.ts`, `reimbursement-correction-guide.test.tsx` (labels prop), `fund-name-literal-scan.test.ts` (allowlist now `{}`).

### Implementer Notes
- **Scan allowlist is empty** and the scan test passes; the stale-entry test is vacuous now by design.
- **Impact page decision (`members/impact/page.tsx:89`):** reworded to "Giving transactions will appear here once they are posted." The line named the old fund and the design says member pages never print a fund name (`MEMBER_EXPOSED_FUND_KINDS`), so it would have gone stale on rename. Copy change only.
- **Guide:** "Activities account" stays findable in Books & the Register ("<name> is the fund Lions International calls the 'Activities account'..."); a test pins it. Register page shows `fundExplainer(kind, labels)` under the subtitle.
- **Portal event bug found live:** the donor picker sits inside the transaction `<form>` while rendering in a portal; React events bubble through the React tree, so the create-donor form's submit saved the gift early (no donor). Fixed with `onSubmit` stopPropagation on the picker dialog content; a source-scan test pins it. Worth remembering for any dialog-with-a-form placed inside another form.
- Donor panel uses a derived-loading pattern (no synchronous setState in the effect) to satisfy `react-hooks/set-state-in-effect`.
- Counterpart is not on the New Category dialog (not in the design's file list); set it with the row's Counterpart action after creating.
- The register's Link donor on a Public Funds row reuses `LinkDonorDialog`, whose text still says "for acknowledgment tracking"; harmless, left (copy candidate).

### Deviations from the design
- `mirrorHints` is a `Record<categoryId, MirrorProjection>` built on the server with the existing `loadMirrorProjections()` (about 8 lines across two pages); no new helper or route. Absorbed.
- `fundExplainer` gained an optional `labels` argument (4 lines) so the sentence follows a renamed fund. Absorbed.
- `mirrorTargetOptions()` added to `ledger-category-ui.ts` (about 12 lines, pure, tested). Absorbed.
- Nothing goes back to Phase 3.

### Live check (worktree dev server :3101, pipeline branch `ep-silent-silence`, stopped afterwards; :3000 untouched)
Renamed the Club public fund to "Community Money" through the fund PATCH for the check, then back to "Public Funds" at the end (branch data only).
- Categories: no "Activity" word and no "activity fund" on the page; Counterpart lines show `Counterpart: White Cane · No Form 990 line` and `Counterpart: Public donations · Contributions/gifts/grants`. Cleared the Public donations counterpart (toast, line gone), set it back (toast). Picker lists 14 options: "None, stays in Community Money" plus active Foundation charitable income categories. Edit flags on a mirrored row: both checkboxes disabled (counts: checked; receipt-not-required: unchecked), note names the Foundation category, "The Foundation reports this under: Contributions/gifts/grants." Foundation row shows "Counterpart of: White Cane". Deactivate on it warns "1 Community Money category points to it as its Foundation counterpart".
- Register: subtitle "Public fund • Club • FY2026"; explainer present. Category Public donations shows "Foundation-bound ... A receipt will be needed" at $300 and "No receipt is needed" at $20; a category with no counterpart shows "stays in Community Money". Created donors `Example Donor Four` (example.invalid) in the picker, chip appeared, POST carried `donorId`, row shows Re-link and no Acknowledge button.
- Donor page: Total Giving $0.00 with "Foundation gifts only", row labelled "Community Money, not yet a Foundation gift", no Acknowledge.
- Pages with no "Activity" word after rename: register, Treasury guide (and "Activities account" present), settings, overview, reports, approvals, compliance, `/members/impact`.
- 360px: transaction dialog and donor picker have no horizontal scroll, page has none; picker rows and Choose/Clear/Change are 44px. Existing form buttons are under 44px (Cancel, Record Transaction 38px, close icon 28px): not this diff.
- Cleanup: all test transactions deleted through the audited DELETE and the test donors deleted; none left. Earlier runs created three more test entries from the portal bug; all removed.

### Handoff to qa
- Click through: categories (set/clear counterpart, flags dialog, deactivate, merge a zero-history Public Funds category that is a counterpart), register new gift with donor, donor page total, guide and settings after renaming the fund (S2).
- New copy to refine: "Foundation-bound: this gift is swept to the Foundation as ...", "Counterpart: / Counterpart of:", the flags note, "Foundation gifts only", "<fund>, not yet a Foundation gift".
- e2e: the seven specs that read the fund literal still need the database-resolved helper (qa step).

### Phase 4 loop-back (ux-developer, 2026-10-17)

- **Defect (qa S2):** `fundKindLabel(kind)` in `budget-plan-status.tsx` capitalised the raw kind, so the Budgeting overview and drill-down showed an "Activity" badge beside the fund named "Public Funds" (DECISION-127 ruling 9).
- **Fix:** both call sites (`budget-overview-table.tsx`, `budget-plan-status.tsx` drill-down badge) now call `fundKindBadge(kind)` from `src/lib/ledger-fund-labels.ts` ("Public" for `activity`); the `fundKindLabel` export is deleted and the file header comment updated (five functions became four). `ledger-category-ui.ts`'s differently-signatured `fundKindLabel(fundKind, funds)` left alone.
- **Files touched:** `src/components/admin/ledger/budget-plan-status.tsx`, `src/components/admin/ledger/budget-overview-table.tsx`. No unit test imported the removed export; no e2e spec asserts on the kind badge text (the matches in `budgeting-overview-restructure`, `budget-star-notes`, `transaction-budget-line-link` are comments, fund-name helpers or fixture labels). No deviations.
- **Scan test `src/lib/fund-kind-badge-scan.test.ts`:** before the fix 1 failed / 3 passed (reproduced by temporarily restoring the raw capitalisation); after, 4 passed.
- **Gates (worktree):** `tsc --noEmit` clean; `pnpm lint` 0 errors, 1 warning (pre-existing, `budget-context-panel.tsx:114`); `pnpm test` 313 files passed, 5188 tests passed.

### Phase 6 follow-ups landed (full-stack-developer, 2026-10-17): N1, N2

Worktree `.claude/worktrees/itemized-sweep-inc1`, uncommitted. No schema, no new API, no permission.

**N1 files:** `src/lib/ledger-category-mirror.ts` (new `LUMP_SWEEP_NOTE` const + two branches), `src/components/admin/ledger/category-mirror-dialog.tsx`, `src/components/admin/ledger/category-deactivate-confirm.tsx`; tests `foundation-bound-hint.test.tsx`, `ledger-category-mirror.test.ts`, and `e2e/ledger-category-mirror.spec.ts` (three string pins, not run).

Final wording (fund name always from `FundLabels`):
- Hint, receipt branch: `Foundation-bound: this gift belongs with the Foundation's "X" category, and a written receipt will be needed. Sweeps are still recorded as one lump amount for now, so the Foundation will not show this gift or its donor yet.`
- Hint, under $250 / ack-exempt: `Foundation-bound: this gift belongs with the Foundation's "X" category. No written acknowledgment is required for this one (you can still send one from the Foundation). <same lump note>`
- Hint, stays: `This category has no Foundation counterpart, so it is recorded as staying in <fund>. Today's lump sweep does not check this.` (inactive variant: `... is deactivated, so it is recorded as staying in <fund> until it is re-pointed. Today's lump sweep does not check this.`)
- Counterpart dialog: `Records which Foundation category this <fund> category belongs with. The Foundation category also decides whether a gift counts as giving and whether a receipt is needed. Itemized sweeps will use it; today's lump sweep ignores it, and no copy or donor reaches the Foundation yet.`
- Deactivate warning tail: `... Foundation counterpart (names). The counterpart link will show as inactive until it is re-pointed.`

**N2 files:** `category-merge-dialog.tsx` (new required `labels: FundLabels` prop; text now `{labels.activity}`), `category-list.tsx` (passes `labels`), `src/app/api/admin/ledger/transactions/route.ts` (`donor_not_applicable` message reads `getFundLabels().activity`, computed only in the refusal branch), `route.test.ts` (mocks `ledger-fund-labels-queries`), `src/lib/fund-name-literal-scan.test.ts`.
Scan extension: `/\bPublic Funds\b/` after `stripComments()` over every ledger-surface file except `lib/ledger-fund-labels.ts` (test files already excluded) must be empty, plus a negative control (string, JSX and template shapes match; line and block comments do not). The only two code offenders were the two named; no others.

**Gates (worktree):** `tsc --noEmit` clean; `pnpm lint` 0 errors, 1 warning (pre-existing `budget-context-panel.tsx:114`); `pnpm test` 313 files / 5190 tests passed (was 5188; +2 scan cases); `pnpm build:only` passed. The e2e pins were edited but not executed (no dev server).

---

# Phase 5 — Verification (qa)


## Phase 5 — Verification — 2026-10-17

**Owner:** qa
**Status:** complete (first run FAIL, returned to ux-developer; re-verified PASS, see the re-verification subsection)

### Summary
**Superseded: re-verified PASS on 2026-10-17 (see "Re-verification after loop-back" below). First-run text follows.**

**Verdict (first run): FAIL.** One defect, one line of feature code: `src/components/admin/ledger/budget-plan-status.tsx:29-30` (`fundKindLabel`) capitalises the raw kind (`kind.charAt(0).toUpperCase() + kind.slice(1)`), so the Budgeting overview (`/admin/ledger/budgeting`) and the drill-down (`/admin/ledger/budgeting/activity`) print a kind badge reading **"Activity"** beside the renamed fund. Parent check S2 expected 0 rendered "Activity"; observed **2** (those two pages). The failing regression test is already in the tree: `src/lib/fund-kind-badge-scan.test.ts` ("should not capitalise a fund kind string for display — regression for the Budgeting overview 'Activity' badge"), the only red test in `pnpm test`. Everything else passed: tsc, lint, build, 5187 other tests, migration idempotence, the design-named tests, the click-through, the gate audit.

Measured on: branch `worktree-itemized-sweep-inc1`, HEAD `014f7f6` (base, nothing committed), `git status --short | wc -l` = 81, Neon branch `ep-silent-silence-…` (host confirmed before every write; :3000 and production untouched).

### What I did

**Leftovers from the interrupted qa run (decisions)**
- `e2e/helpers/fund-names.ts` — KEPT (small, correct: reads the stored fund name via the app's own `buildFundLabels()`).
- Seven edited specs (`budget-star-notes`, `budgeting-overview-restructure`, `ledger-approvals-cosign`, `-history`, `-mobile`, `ledger-category-management`, `ledger-move-transaction`) — KEPT as is. Each diff only replaces the "Activity Fund" literal with a name resolved from the database. Their runs are below.
- `e2e/ledger-category-mirror.spec.ts` — it was complete (299 lines, afterAll cleanup, no truncation), so KEPT, not rewritten. 7/7 pass on the branch both with the fund named "Activity Fund" and renamed "Community Money". It covers set a counterpart, read-only flags plus the API flag refusal, self/Club/unknown refusals, the $250 hint, the donor-picker submit-bubbling regression (asserts zero early POSTs), donor-page label and $0 total, clearing the counterpart.
- `src/lib/fund-kind-badge-scan.test.ts` — qa's (its header cites "Phase 5, S2"; the ux-developer's Phase 4 notes do not claim it). KEPT. It is the failing-first regression for the defect above. Handed back red on purpose.
- The resume note under this heading is deleted.

**Gates**
- `pnpm exec tsc --noEmit`: PASS.
- `pnpm lint`: PASS, 0 errors, 1 warning (`budget-context-panel.tsx:114`, concurrent, not this diff).
- `pnpm test`: **313 files / 5188 tests: 5187 passed, 1 failed** (`fund-kind-badge-scan.test.ts`). Phase 4 ended at 312 / 5184; delta is the scan file (4 tests).
- `pnpm build:only`: PASS.
- e2e: see below.

**Design-named tests (Phase 3, Tests, Increment 1): all present and passing.** `ledger-category-mirror-schema.test.ts`, `fund-name-literal-scan.test.ts` (allowlist `{}`), `ledger-fund-labels.test.ts`, `ledger-category-mirror.test.ts`, `ledger-donor-giving.test.ts`, `foundation-bound-hint.test.tsx`, `donor-picker-field.test.tsx`, `transaction-form-donor.test.tsx`, `guide/treasury-guide-labels.test.tsx`, extended `txn-donor-actions.test.tsx` and `ledger-category-ui.test.ts`, the mutual-exclusion test (`ledger-fund-move-policy.test.ts:166`, "no (from, to) pair is allowed by both policies"), `admin-page-feature-gates.test.ts`, `default-role-bundles.test.ts`. One naming drift, not a failure: the `getDonor` `entityDonationsDeductible` test sits in `ledger-queries.test.ts:2557`, the design said `ledger-queries.donors.test.ts`.

**Migration `0115_ledger_category_mirrors.sql`**
- `pnpm db:migrate` run twice (then three more replays for S1): every run exit 0, the 0115 line runs, seed marker `category_mirrors_seeded` stays at **1 row**, mirror links stay at 2 (untouched by replays).
- Schema and migration agree: DB column `mirrors_category_id uuid NULL`, no default; FK `ledger_categories_mirror_fk` ON DELETE SET NULL; `schema.ts:783/793` match; the schema test pins it.
- `drizzle-kit push` dry run: NOT completable. It stops at the known B-165 prompt (`ledger_entities_slug_unique`) and needs a TTY; I did not answer or force it.

**e2e (dev server on :3101, one worker, Neon branch)**
- Full suite started; stopped by me at test 96/453 with 0 failures (about 5 tests a minute here, far slower than the 12 minutes budgeted: each remote query takes 100 to 400 ms). I then ran every ledger, budgeting, approvals, donor and acknowledgment spec (16 files, 240 tests).
- The dev server log shows `ECONNRESET` and `CONNECT_TIMEOUT` to the Neon pooler (48 times) and nothing else that is application code. Failures moved around between runs (sign-in waits, 5 s move toasts at 2.6 to 5 s per move POST, one `Failed query`). Each failing test passed on re-run, with these results: `ledger-category-management` 15/15, `ledger-approvals-mobile` 12/12, `budget-star-notes` 6/6, `budgeting-overview-restructure` 6/6, `budgeting-restructure` 15/15, `ledger-move-transaction` 15/15 in one run (flaked 1 of 2 on the 5 s "Moved to…" toast in others), `ledger-approvals-history` 51 passed and the edited Sweep assertion passed, `ledger-approvals-cosign` the edited Sweep-card test passed (1/1); the long cosign file's 20x loop tests (L10 and the like) time out on this latency, so that file never completed in one pass.
- One real non-diff failure: `ledger-approvals-history.spec.ts:1037` expects `localhost:3000` in the callback cookie, so it cannot pass on :3101 (concurrent, not this diff; the line was not edited by this pipeline).
- Net: no e2e failure traced to this diff. The e2e signal is weaker than usual because of the latency; the orchestrator should re-run the ledger specs on :3000 against a nearer database before push.

**Click-through on :3101 as the e2e admin (Playwright-driven, DOM text read, plus screenshots)**
| Flow | Result | Notes |
|------|--------|-------|
| Rename the fund in the fund editor to "Community Money", then back to "Activity Fund" | pass | Both done through the Edit fund dialog; the branch row reads "Activity Fund" again |
| Renamed name on register, settings, categories, guide (15 mentions), reports, approvals (pending and decided), reconciliation, reimbursements, donors, search, compliance, `/members/impact`, `/members/financial-reports`, `/members/finances` | pass | 0 "Activity" except below |
| Budgeting overview and drill-down | **FAIL** | Kind badge "Activity" on both (the defect) |
| Denial reasons | pass | Transfer refusals read "Administrative funds cannot be moved into Community Money: its income must stay publicly-sourced. See Community Money policy."; move dialog says "Public money cannot be moved into the Administrative Fund." |
| Set, change, clear a counterpart | pass | 200 each |
| Refusals | pass | self 400 `target_is_self`; Club target 400 `target_not_foundation_income`; inactive target 400 `target_inactive`; flag edit on mirrored 400 `mirrored_flag_read_only` (both flags); expense or Administrative subject 400 `subject_not_public_income`; malformed 400 `invalid_mirror`; unknown 404. All plain-language, no 500 |
| Merge and deactivate with a mirror | pass | Plan then apply merging a Foundation category: `mirrorsRepointed` 1 and the Club category re-pointed; two differing counterparts: 409 `mirror_conflict`; deactivating a target makes the Club category show the target as inactive |
| Gift with donor and mirrored category | pass | Hint "No receipt is needed" at $20, "A receipt will be needed" at $300; unmirrored category says "stays in <fund>" |
| Donor page | pass | Total excludes the gift (Foundation gifts only; spec asserts $0.00 and the label) |
| Edit the entry's donor | pass | PATCH 200, donor is the new one |
| Donor on expense, unknown donor | pass | 400 `donor_not_applicable`, 404 `donor_not_found` |
| `/members/impact` | pass | Page text identical before and after a $300 gift; no fund name; no double count |
| Lump Transfer/Sweep regression | pass | Pair records (201, posted), memo shows on the Club and the Foundation registers, deleted cleanly; reverse direction still denied |
| 360px: transaction form, donor picker, category dialog | pass | `scrollWidth` 360 = viewport on all three; dialog reads cleanly |
| Test data | cleaned | 0 leftover transactions or donors; QA fixture categories remain inactive and un-mirrored (categories are never hard-deleted): about 10 `QA E2E Mirror …`/`QA WALK …` rows on the branch |

**Donor-picker submit-bubbling fix (item 7): confirmed.** With `onSubmit={(e) => e.stopPropagation()}` (donor-picker-field.tsx:65) removed, `donor-picker-field.test.tsx` fails ("stops the create-donor form's submit from bubbling"); restored, 5/5 pass. Honest limit: that unit test is a source scan; the behavioural guard is the e2e regression in `ledger-category-mirror.spec.ts`, which passes with the fix (I did not run the e2e with the line removed).

**Security and invariants**
- No `console.log`, native dialog or personal data in the diff; the only non-club addresses are `example.invalid` fixtures. `approvedAt` guards: no change in the diff. Policy mutual exclusion untouched and green.
- Feature-gate audit (read from the route files):

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct key? |
|-----------------|-------------------|----------------------------|--------------|
| `PATCH /api/admin/ledger/categories/[id]` (mirror, flags, merge target) | yes | yes | `LEDGER_MANAGE` |
| `POST /api/admin/ledger/categories/merge` | yes | yes | `LEDGER_MANAGE` |
| `POST /api/admin/ledger/categories` (`mirrorsCategoryId`) | yes | `hasAnyFeature(BUDGET_WRITE_FEATURES)` for the route, plus `LEDGER_MANAGE` required before any lookup when `mirrorsCategoryId` is sent | yes |
| `GET /api/admin/ledger/categories` and `/[id]/impact` | yes | yes | `LEDGER_MANAGE` |
| `POST /api/admin/ledger/transactions` (`donorId`) | yes | yes | `LEDGER_RECORD` |
| `PATCH` and `DELETE /api/admin/ledger/transactions/[id]` | yes | yes | `LEDGER_RECORD` |
Not exercised with a real under-privileged user (no fixture user without `ledger.manage` on this branch); asserted by code reading plus the route unit tests (`categories/route.test.ts`, `categories/[id]/route.test.ts` cover the 403s). New pages carry their own `auth()`/`hasFeature()` check (`admin-page-feature-gates.test.ts` green).

**Parent "Phase 5 live checks" (observed)**
- S1: cleared both seeded mirrors through the PATCH API, replayed `pnpm db:migrate` 3 times: links stayed 0 on 3 of 3, marker stayed 1. Links restored through the API afterwards (2 on the branch).
- S2: renamed to "Community Money", loaded 20 pages: rendered "Activity" count **2** (the two Budgeting pages; the one other hit is the unrelated word in "partisan activity" on Compliance). Expected 0: FAIL until the defect is fixed.
- S7 (2a, measured early with direct back-dated income, no sweep batch exists yet): the Foundation Charitable fund holds $26,336.57 with $46,785.35 of income in the trailing 365 days, so FIFO ages $0 and shows no warning. Posting three back-dated gifts of $1,000 (July to September 2025) changed nothing: no warning before, none after, none after deleting them. The rule is `aged = max(0, balance − trailing-year income)`, so the warning fires only when old gifts push the balance past the trailing-year income: on this branch's data about $20,448.78 of old gifts. Production headroom was not read. The Club Public Funds side is already over its window on this branch ($84.52 aged, no recent income), unrelated to the sweep.
- S3 to S6, S8 to S10: Increment 2a, not run.

### Outputs
- No feature code touched. Kept leftovers: `e2e/helpers/fund-names.ts`, the seven edited specs, `e2e/ledger-category-mirror.spec.ts`, `src/lib/fund-kind-badge-scan.test.ts` (red by design). Temporary walk specs and scripts were created and deleted. Screenshots and logs are in the scratchpad `qa/` folder.
- Parent work-log "Phase 5 live checks" table filled for S1, S2, S7.
- Proposed text: none for decisions or backlog. Suggest a backlog line: `ledger-approvals-history.spec.ts:1037` hard-codes `localhost:3000`; e2e hard-codes entity UUIDs in three specs.

### Open questions / handoff notes
- **Return to ux-developer (Phase 4):** make `fundKindLabel` in `budget-plan-status.tsx:29` return `fundKindBadge(kind)` from `ledger-fund-labels.ts` (or take `labels`); its three consumers are `budget-plan-status.tsx:152` and `budget-overview-table.tsx:75`. The scan test goes green; then qa re-runs: `pnpm test`, tsc, lint, build, S2 on the two Budgeting pages, and `budgeting-overview-restructure` plus `budget-star-notes` e2e. No other defect found.
- The e2e environment was slow and flaky (Neon `ECONNRESET`s); worth re-running the ledger specs on the orchestrator's :3000.
- **Possible side effect to check:** at the end I ran a broad `pkill -f "next-server"` while stopping my :3101 server; nothing is listening on any port now, so if the orchestrator's :3000 server was running it may have been stopped by that command. Restart it if so.
- Next agent: ux-developer on FAIL; analyst for Phase 6 only after a PASS re-run.

### Re-verification after loop-back (qa, 2026-10-17)

**Verdict: PASS.** Measured on branch `worktree-itemized-sweep-inc1`, HEAD `014f7f6`, uncommitted, 83 entries in `git status --short`; Neon branch `ep-silent-silence-…` (host confirmed in `.env.local`, no `PROD_DATABASE_URL`, `RESEND_API_KEY` empty); one dev server from the worktree on :3000, stopped by pid at the end (pids 76937, 76948, 76994; `lsof` shows nothing on :3000 or :3101).

**The fix, read not diffed:** `budget-plan-status.tsx:149` and `budget-overview-table.tsx:75` both render `{fundKindBadge(...)}`; `fundKindBadge("activity")` returns "Public" (`ledger-fund-labels.ts:80-83`). No `fundKindLabel` export remains in `budget-plan-status.tsx`. `charAt(0).toUpperCase()` still appears twice under `src/components/admin/ledger`, in `reconciliation-match-picker.tsx:48` and `unremitted-deposits-panel.tsx:30`; both are the `paymentMethodLabel()` fallback that title-cases a payment method such as `check`, nothing to do with a fund kind (none under `src/app/(dashboard)/admin/ledger`). Two component files, as the ux-developer reported.

**Gates (worktree, after the fix)**
| Gate | Result |
|------|--------|
| `pnpm exec tsc --noEmit` | PASS, 0 errors |
| `pnpm lint` | PASS, 0 errors, 1 warning (`budget-context-panel.tsx:114`, unused eslint-disable, same as before, not this diff) |
| `pnpm test` | PASS, **313 files / 5188 tests passed, 0 failed** (4.8 s); `fund-kind-badge-scan.test.ts` green |
| `pnpm build:only` | PASS (exit 0; 332 route lines) |

**S2 recount (live, :3000).** Fund name before: "Activity Fund". Renamed through the Edit fund dialog to "Community Money" (the database read back "Community Money"), then restored; read back "Activity Fund". `/admin/ledger/budgeting`: "Activity" **0**, kind badges `Administrative`, `Public`, fund name present. `/admin/ledger/budgeting/activity`: "Activity" **0**, badge `Public`, fund name present. Parent S2 row updated with an "Observed after fix" clause.

**e2e (serial, `--workers=1`, dev server :3000): 17 spec files, all green after classification.** A temporary driver spec and a temporary copy of the cosign spec were created and deleted (the cosign copy only raises the `test.setTimeout(120_000)` on line 52 to 900 s).
| Spec | Result | Classification |
|------|--------|----------------|
| `ledger-category-mirror` | pass 1st run (7/7) | n/a |
| `budget-star-notes` | pass 1st run | n/a |
| `budgeting-overview-restructure` | pass 1st run | n/a |
| `acknowledgment-letter-generation` | pass 1st run | n/a |
| `ack-queue-workflow` | pass 1st run | n/a |
| `deposit-in-transit-carveout` | pass 1st run | n/a |
| `prior-year-cause-line-reconcile` | pass 1st run | n/a |
| `transaction-budget-line-link` | pass 1st run | n/a |
| `ledger-approvals-mobile` | pass 1st run | n/a |
| `ledger-move-transaction` | 1st run fail (sign-in wait, 15 s), re-run pass | infrastructure |
| `ledger-reimbursement-correct` | 1st run fail (`Balanced.` text not found in 20 s), re-run pass | infrastructure |
| `ledger-approvals-history` | 1st run fail (`page.goto` interrupted by `chrome-error://chromewebdata/` at line 1047; the spec now reaches :3000), re-run pass (full file) | infrastructure |
| `budgeting-restructure` | 1st run fail (45 s `goto` abort, then its cleanup hit `ECONNRESET`); 2nd run fail (sign-in wait); 3rd run pass | infrastructure |
| `admin-ledger-budget-committee-gate` | 1st and 2nd run fail (sign-in wait, different tests); 3rd run pass | infrastructure |
| `ledger-category-management` | 1st run fail (sign-in wait); 2nd run fail on `:192` budget total 2 not 1; 3rd run pass (15/15) | infrastructure (see below) |
| `ledger-search` | 4 runs: fail at a different test each time (sign-in wait twice, `goto` aborted); 5th run pass (14/14) | infrastructure |
| `ledger-approvals-cosign` | 1st and 2nd run: L10 hit the spec's own 120 s ceiling (300 POSTs at about 400 ms each); a 900 s-timeout copy ran L10 to a pass and 42 tests, then a fixture `delete` died with `read ETIMEDOUT`; the remaining sections (Stale toasts through Approver email) re-run: 31 passed | infrastructure |

*Why I call these infrastructure (established vs believed).* Established: every first-run failure is a timeout or a database connection error at a different place each time (`helpers/auth.ts:35` sign-in wait, `goto` aborts, `ETIMEDOUT`, `Failed query … ECONNRESET`); the dev log holds 18 `ECONNRESET`/`CONNECT_TIMEOUT` lines and six `[auth] CallbackRouteError … Failed query: select … from "users"` (the sign-in query itself failed); credential sign-in takes up to 1.9 s server-side; no failure repeated at the same assertion across runs except where noted; every spec passed on a re-run with no code change. Believed (not proven): the Neon pooler link from this machine is slow and drops connections. The one non-timeout assertion, `ledger-category-management` `:192`, was budget rows left behind on the "Charitable donation out" category by the failed `budgeting-restructure` run (FY2099 row, cleanup died on `ECONNRESET`) and the in-flight committee-gate spec (FY2093); it passed once those specs completed and cleaned up, 15/15. `ledger-category-mirror` was green on the first attempt both times it ran.

**Not re-run on purpose:** the full click-through, migration replays, S1, S7, and `drizzle-kit push` (B-165 prompt). They stand from the first run.

**Open items for the orchestrator**
- The ledger e2e remains slow and flaky from this machine (about one failure per 3 specs on the first pass). Every spec went green, but a clean first-pass signal needs a nearer database.
- Leftover test data: none seen at the end beyond the inactive `QA …` fixture categories noted in the first run. The fund name is "Activity Fund" again.
- Next agent: analyst for Phase 6 (after Inc 2b, per the status table).

## Type Check

`pnpm exec tsc --noEmit`: PASS

## Production Build

`pnpm build:only`: PASS

## Dev-Server Smoke Test

Worktree dev server on :3101 against the pipeline Neon branch: PASS (only DB connection resets in the log).

## Verdict

**PASS** (re-verification after loop-back, 2026-10-17; measured on branch `worktree-itemized-sweep-inc1`, HEAD `014f7f6`, uncommitted, `git status --short | wc -l` = 83). The first run's FAIL (Budgeting kind badge printed "Activity") is fixed; see "Re-verification after loop-back" above.

---

# Phase 6 — Shipped vs Intent (analyst)

**Scope of this section: Increment 1 only** (rename to Public Funds, category mirrors, donor on Public Funds income, the Foundation-bound hint, label-driven denial and correction wording). It is a standalone-deploy review. **The B-172-wide Phase 6 remains scheduled after Increment 2b** (the 990 prep figure moving, the moved-and-swept gift walk, the lump-path closure, the gift-date and fiscal-year walks); nothing here closes B-172, and DECISION-126 stays Proposed.

*Review of 2026-10-17. Read-only: no code, database, dev server or production touched. Code read in the worktree `/Users/cshenso/git/westervillelions/.claude/worktrees/itemized-sweep-inc1` (HEAD `014f7f6`, uncommitted, 83 entries); production facts are quoted from the parent work-log's "Production facts (orchestrator, 2026-10-16)", not re-read.*

## VERDICT

**SHIP WITH NOTES.** Increment 1 delivers the Increment 1 slice of Phase 1 and changes no money flow, receipt, 990 or roll-up number on its own. It is safe to deploy before 2a exists, with one recommended copy pass first (N1) and two things the user must be told (the rename step and what the counterpart does not do yet).

## ONE-LINE TAKE

> The Ledger now reads the fund's stored name everywhere, a Public Funds income category can declare its Foundation counterpart, and a gift can carry its donor, but the counterpart is a label until Increment 2 itemizes the sweep, and a few sentences on screen already talk as if it were not.

## What's Working

- **Rename is one source and proven against rendered pages.** The scan allowlist is `{}`. I re-grepped the worktree: every remaining `Activity Fund` / `activity fund` in non-test `src` is inside a comment (`approval-dialog-context.tsx:5`, `ledger-queries.ts:346`, `ledger-fund-labels.ts:5`, `ledger-transfer-policy.ts:17`, `ledger.ts:37,1331`, `ledger-correction.ts:372`, `ledger-fund-move-policy.ts:19`, `ledger-approval.ts:67`), none in a string, a migration or a script. QA's S2 rendered 20 pages under a renamed fund and, after the loop-back fix, found 0 "Activity" on Budgeting (kind badges now `Administrative` / `Public`). The one non-ledger member page that named the fund (`/members/impact`) was the only member-facing file changed.
- **The mirror is read by nothing that moves money.** I grepped every use of `mirrorsCategoryId` / `mirrors_category_id` in `src`: the only readers are the category screen and its queries (`ledger-category-queries.ts`, `ledger-category-ui.ts`, `category-*` components, the two category routes), `loadMirrorProjections()` for the Foundation-bound hint on the register and overview pages, and `schema.ts`. No roll-up (`impact-stats-queries`, `isGiving`, 990 prep, gross receipts), no acknowledgment query (`listPendingAcknowledgments` only swapped the literal `25000` for `ACK_MIN_CENTS`, same value), no `handleTransfer` path reads it. The lump sweep still writes the same two rows, with the same `Public donations` fallback category on the Foundation leg. So the mirror is purely informational today.
- **The seed is one-shot and cannot undo the treasurer.** Migration `0115` guards the whole `UPDATE` with an `ledger_audit_log` marker (`category_mirrors_seeded`) inserted in the same `DO` block, `mirrors_category_id IS NULL` only, two names only (`Public donations`, `White Cane`), no contested pair, no person. QA replayed it 5 times, S1 3/3 stayed cleared. Fresh-install literal in `0044` is `WHERE NOT EXISTS` and no later migration, script or e2e fixture looks the fund up by the old name (I grepped `drizzle/` and `scripts/`: zero hits).
- **The donor picker does what Flow 1 said.** Income into Public Funds or the Foundation Charitable fund takes `donorId` on create (400 `donor_not_applicable` elsewhere, 404 `donor_not_found`), "Add donor" is inside the picker rather than a dead end, the Link donor control on a Public Funds row never shows Acknowledge, Mark Sent or "Ack sent" (a Club row can never hold an acknowledgment), and the real bug QA and the ux-developer found (the picker's create-donor form bubbling its submit through the React portal and saving the gift early) is fixed and guarded by an e2e that asserts zero early POSTs.
- **The donor page no longer double counts in waiting.** `sumDeductibleGiving()` makes Total Giving count Foundation rows only and labels a Public Funds row "<fund>, not yet a Foundation gift". This was a Phase 3 find (the architect's invariant 6) fixed before it could bite.
- **Failure microcopy is human.** Every mirror refusal has plain-language copy from one exhaustive record (`MIRROR_COPY`); network failure in the counterpart dialog says "Check your connection and try again."; no stack trace or raw code reaches the page.
- **Gates are real.** tsc, lint (0 errors), 313 files / 5188 tests, `pnpm build:only`, migration replays, 17 e2e specs all green after classification; the one first-run FAIL (Budgeting badge) was caught by QA, fixed, and now has a scan test.

## Intent-vs-Shipped Diff

| # | Phase 1 / 2 / 3 said | Shipped | Verdict |
|---|---|---|---|
| 1 | Rename the Activity fund to Public Funds by the stored name; every UI string, denial reason, guide page, report header reads it; `kind` and slug untouched; the production row renamed by the user in the audited fund editor, no migration does it. | Labels module + `FundRef.name` + functions of `FundLabels`; scan empty; fresh-install seed `Public Funds`; no migration touches an existing row. | **matches** |
| 2 | "No hard-coded 'Public Funds' except the fallback default" (Phase 3 Edge Cases, DECISION-127 rationale). | Two stray literals: `category-merge-dialog.tsx:223` ("N Public Funds categories have ...") and `transactions/route.ts:285` (the `donor_not_applicable` message). The scan bans only "Activity", so it cannot catch these. They contradict the stored name in the rename window and after any later rename. | **acceptable drift** (N2) |
| 3 | Kind badge is a static noun, not the stored name. | `fundKindBadge`: "Public" for `activity`. Before the user renames the fund, a badge reads "Public" beside a fund still named "Activity Fund". | **acceptable drift** (cosmetic, one-line in release notes) |
| 4 | Phase 1 Inc 1 listed `Transfer to Foundation` and the mirrors; Phase 3 moved `Transfer to Foundation` to 2a (a seeded expense category would let a hand-keyed one-sided expense drain the fund). | Not seeded in Inc 1. | **acceptable drift** (ruling 1, correct) |
| 5 | Phase 1: Activity category shows the Foundation's receipt, 990 and giving values read-only. Phase 2 narrowed 990 to informational. | `countsAsGiving` and `ackNotRequired` read-only while a counterpart is set (400 `mirrored_flag_read_only`), the Foundation's 990 line shown as information, `form990Line` stays Club-owned. Consequence: after the seed, the two seeded Club categories cannot have those two flags edited without first clearing the counterpart (a behavior change; I found no roll-up, budget or acknowledgment query that reads a Club income category's two flags, so nothing downstream moves). | **acceptable drift** |
| 6 | Seed the unambiguous pairs only; contested pairs left for the treasurer. | `Public donations` and `White Cane` only. The dev branch also holds a Club `Zeffy Donations` category, unmirrored; whether production does is unknown (see Verify-First). | **matches**; the open decision is N5 |
| 7 | Flow 1: the form says "Foundation-bound: yes, will be copied as <category>; receipt: needed / not needed / sent elsewhere"; a category with no mirror says it "stays in Public Funds and cannot be swept". Phase 1 Inc 1 table: the treasurer can "see which gifts are Foundation-bound and whether they will need a receipt. Sweeps still work the old (lump) way during this increment." | Hint shown under Category on new Public Funds income: "Foundation-bound: this gift is swept to the Foundation as "X". A receipt will be needed / No receipt is needed" (under $250 or ack-exempt), and "... has no Foundation counterpart, so the gift stays in Public Funds". "Sent elsewhere" is not present (it is derived in 2a). **This is what Phase 1 asked for, but in the lump era the sentences are false as written:** a gift is not swept as itself, the Foundation receives one anonymous lump, nothing is held back in Public Funds because a category has no counterpart (the lump sweep takes whatever amount is typed), and no receipt path exists from a Public Funds row. The same present-tense promise is in the counterpart dialog ("it becomes a gift in the counterpart category") and the deactivate warning ("Their gifts will stay in Public Funds until each is re-pointed"). | **acceptable drift in intent, regression risk in reading** (N1) |
| 8 | User answer 1: the Foundation copy carries the original gift date. | Nothing in Inc 1 touches a date, a copy or a period verdict; `ledger_transactions` is not altered. This is wholly a 2a concern (`sweepCopyPeriodVerdict`, per-copy fiscal-year placement). | **not applicable to Inc 1** |
| 9 | User answer 2: the portal sends the written acknowledgment; Zeffy's email does not replace it; mirror categories seed `ack_not_required = false`; a copied gift of $250 or more joins the pending list. | The hint reads the Foundation counterpart's `ackNotRequired` (`false` on both seeded production pairs per V5) and the $250 floor via `ACK_MIN_CENTS`, so $300 says a receipt will be needed and $20 says none is. Wording of the under-$250 branch ("No receipt is needed") is stronger than the ledger's policy, which lets the treasurer acknowledge any amount. No copy is made and nothing enters the pending list in Inc 1. | **matches** the answer; wording note in N1 |
| 10 | Permissions: no new key; `ledger.record` for the gift and donor, `ledger.manage` for the counterpart. | Confirmed from the diff and QA's gate audit: counterpart set/clear/merge/create-with-counterpart = `ledger.manage` (POST sends a plain-language 403 before any lookup); transaction create with `donorId` = `ledger.record`; `donors` GET/POST already `ledger.record`; `default-role-bundles.test.ts` and `admin-page-feature-gates.test.ts` unedited and green. The register and overview pages now also load Foundation category names and receipt flags for the hint, but only for holders who already see the register. | **matches**, nothing widened |
| 11 | Member-facing: `/members/impact` and `/members/financial-reports` must not move. | One copy line on the impact page empty state (drops "Activity and Charitable funds", now "Giving transactions will appear here once they are posted."). QA: page text identical before and after a $300 gift, no fund name, no double count. Public Funds is not in `MEMBER_EXPOSED_FUND_KINDS`. | **matches** |
| 12 | Phase 3 ruling 4: the donor page totals Foundation gifts only. | Shipped as designed. Visible consequence worth stating: a donor whose gift was moved into Public Funds (DECISION-112) now shows a lower total than before, and a donor with only Public Funds gifts shows $0.00 with the label. | **matches** (tell the treasurer) |

## Edge Cases

- **Empty state:** pass. No counterpart: the picker offers "None, stays in <fund>" and the category line is simply absent; a category with no Foundation income categories shows only the none option; no mirror hint renders on Administrative, Foundation or expense forms.
- **Failure microcopy:** pass. Plain-language refusals for all eight mirror codes, `donor_not_found` keeps the other fields, network failures retryable with a human message.
- **Permission gate:** pass by code reading and route unit tests; not exercised with a real under-privileged user (QA says so). Server-side tier on `mirrorsCategoryId` holds.
- **Mobile (360px):** pass (QA: `scrollWidth` 360 on the transaction form, donor picker and category dialog; picker rows and Choose/Clear/Change at 44px). Pre-existing under-44px form buttons are not this diff.
- **Brand:** pass in what I read (`rounded-lg` controls, `rounded-lg` hint, `<ConfirmDialog>` unchanged for deactivate, no native dialogs). The hint panel uses `rounded-lg` rather than a card; fine for an inline note.
- **OAuth vs password, Google Group sync, `/access-pending`, email queue:** not applicable; Inc 1 sends no email and touches no sync.

## Production-safety answers (the six asks)

1. **Rename and handoff.** Nothing in the app tells the treasurer to rename; the handoff lives only in DECISION-127 item 5 and the parent work-log. It is a data step by a `ledger.manage` holder at `/admin/ledger/activity` (the fund's register page) -> **Edit fund** (`fund-manage-dialog.tsx`), audited as `fund_updated`. Until then the app is self-consistent with "Activity Fund" (apart from the "Public" badge). **The release notes must say, in this order:** (a) after this release, rename the Activity Fund to "Public Funds" in Edit fund on that register page; nothing renames it for you; (b) every screen, message and the Treasury guide follow whatever name you set; (c) the new "Public" tag on budgeting pages appears immediately and matches once renamed. Also update `CLAUDE.md`'s "Activity fund" mentions and the printed Treasury guide at ship (the scan covers source only, as DECISION-127 already says).
2. **Does Inc 1 alone change money, receipts, 990 or roll-ups?** No. Confirmed from code: the only mirror readers are display and the category write guard; `handleTransfer` is byte-identical apart from passing fund names into the policy reasons; `ACK_MIN_CENTS` equals the old literal; `donorId` on create writes a column that already existed and that no sum reads for Club rows (the unlinked-gifts and pending-acknowledgment lists both require a deductible entity). The two behaviors that do change today are: the two flags on mirrored categories become read-only, and the donor page total.
3. **Donor picker, receipt hint, Foundation-bound hint vs Phase 1 and the user's two answers.** Match, with the lump-era wording problem in N1. Gift date: untouched (2a). Receipts: the hint follows the portal-sends answer; nothing in Inc 1 issues or suppresses a receipt, and a Public Funds row still cannot be acknowledged, exactly as before.
4. **Permissions.** No new key; nothing widened (see diff row 10).
5. **Member-facing.** One empty-state sentence on `/members/impact`; no member sees a fund name.
6. **"Goes back to the user" items** are triaged under Follow-Ups below (N3 to N6).

## Follow-Ups (SHIP WITH NOTES)

Each becomes its own work-log or backlog line. Order is by when it must happen.

**Before deploying Inc 1**

- **N1 — Make the lump-era copy true (recommended, small, ux-developer, no schema, no API).** Soften the sentences that describe the itemized sweep as if it already worked: the `bound` and `stays` branches of `mirrorHintCopy()` (`ledger-category-mirror.ts:167-183`), the `Dialog.Description` in `category-mirror-dialog.tsx:105-108`, and the deactivate warning in `category-deactivate-confirm.tsx:80-82` ("Their gifts will stay in ..."). Under about 30 lines, absorbed under the scope rule; `foundation-bound-hint.test.tsx` and `ledger-category-mirror.test.ts` pin the strings and change with them. Proposed wording (the orchestrator or ux-developer may refine): hint, receipt branch: `Foundation-bound: this gift belongs with the Foundation's "X" category, and a written receipt will be needed. Sweeps are still recorded as one lump amount for now, so the Foundation will not show this gift or its donor yet.`; under $250 or ack-exempt: `... No written acknowledgment is required for this one (you can still send one from the Foundation).`; stays: `This category has no Foundation counterpart, so it is recorded as staying in Public Funds. Today's lump sweep does not check this.`; dialog: `Records which Foundation category this one belongs with. Itemized sweeps will use it; today's lump sweep ignores it.`; deactivate: `... The counterpart link will show as inactive until it is re-pointed.` If the orchestrator chooses not to touch the code, the alternative is to hold Inc 1 and deploy it with 2a/2b (Phase 3 said 2a and 2b ship together; it did not say Inc 1 must precede them), or to accept the drift and carry the sentence in N7 below. I recommend the copy pass: it is the one place the treasurer at the keyboard is told something false.
- **N7 — Release notes must carry the honest limits.** See "What the release notes and the user must be told".

**Soon after deploy (small)**

- **N2 — Remove the two stray "Public Funds" literals and widen the scan.** Pass `labels` into `category-merge-dialog.tsx:223`, read the name in the `donor_not_applicable` message (`transactions/route.ts:285`), and add the literal `Public Funds` outside `ledger-fund-labels.ts` (and tests) to `fund-name-literal-scan.test.ts` with a negative control. Proposed backlog text below.
- **N8 — e2e hygiene found by QA:** `ledger-approvals-history.spec.ts:1037` hard-codes `localhost:3000`; three specs hard-code entity UUIDs; the ledger e2e is slow and first-pass flaky from this machine. Re-run the ledger specs on :3000 against a nearer database as part of the combined `/pre-push` (QA already asked). Proposed backlog text below.

**Before Increment 2a (surface now, decide before the 2a work-log opens)**

- **N3 — Prior-year sweep policy (Goes back to the user, item 1/3).** Defaults applied, not yet confirmed: prior-year gifts sweepable at `ledger.manage` with a reason, blocked once the Foundation's IRS filing for that year is `filed`. Needs the user's confirm or overturn before 2a implements `sweepCopyPeriodVerdict`. Not needed for Inc 1.
- **N4 — Aged-funds heads-up (no answer needed) plus a production measurement.** S7 measured only the dev branch; production headroom (Foundation Charitable balance minus trailing-year income) has not been read. See Verify-First block 2. Tell the user once, before 2a, that back-dated copies can make the Foundation's aged-funds warning fire sooner.
- **N5 — Treasurer decision on online money's category (new, from the dev branch data).** The branch holds a Club Public Funds income category `Zeffy Donations` that is **not** mirrored, and Open Question 3 left "which category do online gifts use, and what does it mirror" to the treasurer. Under 2a an unmirrored category is unsweepable, so the main online money would sit in "Stays in Public Funds". Ask the treasurer which Club categories are Foundation-bound (`Zeffy Donations`, `Rudolph Run`, `Pancake Breakfast`, `Sponsorships`, `Interest`) and set each from Settings -> Categories -> **Counterpart**; Inc 1 gives her the tool, 2a/2b depends on her answers. See Verify-First block 1.
- **N6 — White Cane has no Form 990 line on the Foundation side** (V5, production). The counterpart line already says "No Form 990 line" on the category screen, which is the prompt; tell the treasurer to set the line on the Foundation `White Cane` category before copies exist, otherwise they report without one.

**Proposed backlog text** (orchestrator files; the next free id is B-198)

- *B-198 — Ledger copy: remove stray hard-coded "Public Funds" strings and extend `fund-name-literal-scan.test.ts` to ban the literal outside the labels module (found at B-172 Inc 1 Phase 6: `category-merge-dialog.tsx:223`, `transactions/route.ts:285`).*
- *B-199 — Ledger e2e hygiene: `ledger-approvals-history.spec.ts:1037` hard-codes `localhost:3000`; three specs hard-code entity UUIDs; document that the ledger suite needs a database near the runner (Neon pooler latency made first-pass runs flaky).*
- *B-200 — Treasurer decision: which Public Funds income categories are Foundation-bound (`Zeffy Donations`, `Rudolph Run`, `Pancake Breakfast`, `Sponsorships`, `Interest`) and what each mirrors; a Foundation `White Cane` Form 990 line. Gate for Inc 2b go-live, not for Inc 1.*

**Proposed DECISION text**

- DECISION-127 may be promoted to Resolved for Inc 1 after N1 lands. Add a line to item 5: "The release notes and the post-deploy checklist state the rename step (register page -> Edit fund); the app does not prompt for it." Add to item 4: "The scan bans 'Activity'; the literal 'Public Funds' outside the labels module is covered by B-198." DECISION-126 stays Proposed until the B-172-wide Phase 6.

## Production Verify-First (orchestrator runs, read-only, `BEGIN READ ONLY ... ROLLBACK`, explicit production host check, counts and one aggregate only; paste under "Production facts (orchestrator, 2026-10-17)" in the parent work-log)

**1. Predict the seed and surface N5 before deploy.**

```sql
-- Which Club Public Funds income categories exist, by lower-cased name of interest
SELECT lower(c.name) AS name, c.is_active, count(*) AS categories
FROM ledger_categories c JOIN ledger_entities e ON e.id = c.entity_id
WHERE e.slug = 'club' AND c.fund_kind = 'activity' AND c.flow = 'income'
  AND (lower(c.name) IN ('public donations', 'white cane') OR lower(c.name) LIKE '%zeffy%'
       OR lower(c.name) LIKE '%donation%' OR lower(c.name) LIKE '%online%')
GROUP BY lower(c.name), c.is_active ORDER BY 1;

-- How many posted Public Funds income rows each Club income category holds (counts only)
SELECT c.name AS category, count(*) AS rows
FROM ledger_transactions t JOIN ledger_categories c ON c.id = t.category_id
JOIN ledger_funds f ON f.id = t.fund_id
WHERE f.kind = 'activity' AND t.flow = 'income' AND t.status = 'posted' AND t.transfer_group_id IS NULL
GROUP BY c.name ORDER BY rows DESC;
```

| If | Then |
|---|---|
| Club `Public donations` and `White Cane` both exist | Release notes say "two counterparts are set for you: Public donations and White Cane." |
| Only `Public donations` exists | Say "one counterpart is set (Public donations); set White Cane yourself once its Club category exists." The marker is still written, so the seed will not link it later (by design). |
| A Club category with "zeffy" or "online" in its name exists in production | N5 is live: it is the category online money lands in, it is unmirrored, and the treasurer must choose its counterpart before Inc 2b. Add it to the release-note to-do list. |
| None of those | N5 is dev-branch-only; drop it. |

**2. Foundation aged-funds headroom (for N4, needed before 2a, not for Inc 1).** One aggregate in dollars is the only non-count output; it is a club fund total, not a personal figure.

```sql
SELECT (f.opening_balance_cents
        + COALESCE(SUM(CASE WHEN t.flow = 'income' THEN t.amount_cents ELSE -t.amount_cents END)
                   FILTER (WHERE t.status = 'posted'), 0)) AS balance_cents,
       COALESCE(SUM(t.amount_cents) FILTER (WHERE t.flow = 'income' AND t.status = 'posted'
                   AND t.txn_date >= now() - interval '365 days'), 0) AS trailing_year_income_cents
FROM ledger_funds f JOIN ledger_entities e ON e.id = f.entity_id
LEFT JOIN ledger_transactions t ON t.fund_id = f.id
WHERE e.slug = 'foundation' AND f.kind = 'charitable'
GROUP BY f.id, f.opening_balance_cents;
```

| If | Then |
|---|---|
| `balance_cents` is at or below `trailing_year_income_cents` | Headroom is `trailing - balance`; the heads-up is "a batch of gifts older than a year totalling more than this headroom starts the warning". Quote the number to the user. |
| `balance_cents` already exceeds trailing income | The Foundation warning is already firing (or would at the configured age); the heads-up is moot and back-dated copies cannot make it worse than the balance already does. |

## What the release notes and the user must be told

**Release notes (orchestrator writes at ship; no file lists):**
1. After you update, rename the Activity Fund to "Public Funds": open the fund's register page, choose **Edit fund**, change the name. Nothing renames it for you. Every screen, message and the Treasury guide then follow the name you set.
2. You can now name a Foundation counterpart for a Public Funds income category (Settings -> Categories -> **Counterpart**). Two are set for you if those categories exist: Public donations and White Cane (per Verify-First 1). The counterpart decides which Foundation category a gift will land in and whether a receipt is needed; **today's sweep still records one lump amount and does not use it yet** (say this plainly; it is the honest limit of this release, and it is what N1 makes the screens say too).
3. You can pick or create the donor while keying a gift into Public Funds or the Foundation. The gift form notes whether the gift is Foundation-bound and whether a written receipt will be needed.
4. A donor's page now totals Foundation gifts only and labels Public Funds gifts as not yet Foundation gifts; a donor whose gift was moved into Public Funds will show a lower total than before.
5. The two flags on a category with a counterpart (counts as giving, receipt not required) are read from the Foundation category; clear the counterpart first to change them on the Public Funds side.

**The user, in one message before deploy:** (a) the post-deploy rename step above (needed from them); (b) the N1 decision: tidy four sentences so the screens say the counterpart is not used by sweeps yet, or deploy as is with the release-note sentence (I recommend tidying); (c) heads-up, no answer: back-dated copies can make the Foundation's aged-funds warning fire sooner (N4, number to follow from Verify-First 2); (d) the treasurer questions in N5 and N6, none blocking Inc 1; (e) the prior-year sweep default in N3 awaits their confirm before 2a.

## Red Flags

None. Nothing returns to an earlier phase. N1 is a copy pass inside Phase 4 scope if the orchestrator elects it.

## Handoff (standard template)

**Owner:** analyst  **Status:** complete (Increment 1 only)  **Date:** 2026-10-17

### Summary
Increment 1 matches the Increment 1 slice of Phase 1, changes no money flow, receipt, 990 or roll-up on its own, widens no permission, and is safe to deploy before 2a. Verdict SHIP WITH NOTES: one recommended copy pass (N1), two small cleanups (N2, N8), and three decisions to put to the user and treasurer before 2a (N3 to N6).

### What I did
- Read both work-logs, DECISION-126/127 and B-190 to B-197, then the migration, the mirror carrier, the transaction create route, the donor, hint and dialog components, and grepped the worktree for every reader of the mirror column, every remaining fund-name literal and every migration or script that looks the fund up by name.
- Walked each Phase 1 flow and the user's two answers against what is built; triaged "Goes back to the user".

### Outputs
- This section and the Phase 6 row of the Per-Phase Status table in `/Users/cshenso/git/westervillelions/docs/work-log/2026-10-17-itemized-sweep-inc1-rename-and-mirrors.md`. No code, decision or backlog file edited; proposed text is above.

### Open questions / handoff notes
- Orchestrator: choose N1 (copy pass) or accept with the release-note sentence; run Verify-First 1 before writing the release notes and Verify-First 2 before the 2a work-log opens.
- Pre-push (orchestrator): one combined `/pre-push`; re-run the ledger e2e on :3000 against a nearer database (QA's request); `drizzle-kit push` could not be completed locally because of the known B-165 prompt, but the only schema change is one nullable column and one explicitly named FK that matches `schema.ts` (63 characters or fewer), so I expect no drift; deploys use `--force`.
- B-172 stays open. The wide Phase 6 after 2b must walk: the moved-and-swept gift, the Foundation 990 prep figure moving, the giving total and Club 990 prep unchanged by a batch, a batch spanning two fiscal years, void refusals, the lump-path closure, and the aged-funds state with real copies.

# The Ledger — Quicken Register Import (data seed) — Work Log

> **Slug:** `2026-07-20-ledger-quicken-seed`
> **Surface:** data seed only — no app code, no schema, no UI changes
> **Permission(s):** none (one-off tsx script, run manually with `--apply`)
> **Estimated complexity:** small (one-off script) but data-sensitive
> **Pipeline mode:** Accelerated — Phases 1–3 condensed into the requesting session's task spec (the user supplied the full mapping/skip/opening-balance spec directly); Phase 2 (architect) skipped outright — this is a one-off `scripts/*.ts` seed script, same shape as the existing `scripts/import-roster.ts` precedent, no new directories/dependencies/structural change. Documented per CLAUDE.md "no silent skips."

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | user (condensed) | Complete | Spec provided directly | 2026-07-20 |
| 2 — Architectural review | — | **Skipped** | One-off script, precedent exists (`scripts/import-roster.ts`), no new deps/dirs | 2026-07-20 |
| 3 — Technical design | user (condensed) | Complete | Full mapping/skip/opening-balance spec provided directly | 2026-07-20 |
| 4 — Implementation | full-stack-developer | Complete | dry-run + apply both reconciled exactly | 2026-07-20 |
| 5 — Verification | N/A | — | One-off data seed, not a shipped feature — verified via the script's own reconciliation asserts + direct DB query below | 2026-07-20 |
| 6 — Shipped vs intent | N/A | — | Same rationale as Phase 5 | 2026-07-20 |
| 4c — Production port + dues backfill | full-stack-developer | Complete | Both scripts dry-run + apply reconciled exactly against production; independently re-verified via Neon MCP | 2026-07-20 |

Phases 5/6 are skipped in the formal sense (no qa/analyst agent invoked) because this is a one-time data-seeding operation, not a shipped user-facing feature — there's no flow for qa to click through or for analyst to compare against Phase-1 intent. Correctness was instead verified by (a) the script's own balance-reconciliation assertion, which blocks `--apply` on any mismatch, and (b) a direct post-apply SQL query against the live DB (both below).

---

# Phase 1–3 (condensed) — Spec, as provided by the user

The user (transitioning off the outgoing treasurer's Quicken exports) supplied a complete, line-item spec covering:

- **Inputs:** two Quicken register CSV exports (Foundation ~185 txns ending $X,XXX.XX; Administrative ~110 txns ending $XX,XXX.XX), kept outside the repo at absolute paths under `~/Documents/Treasurer Transfer Documents 07-2024 to 06-2026/`.
- **Target schema:** existing `ledger_entities` / `ledger_funds` / `ledger_categories` / `ledger_bank_accounts` / `ledger_transactions` tables (The Ledger inc1, migration `0044_ledger_books.sql`) — no schema changes.
- **Script contract:** `scripts/import-quicken-ledger.ts`, dry-run by default, `--apply` to execute, idempotent via a `[quicken-import]` memo marker (delete-all-marked + re-insert on every `--apply`).
- **Pre-steps on `--apply`:** delete 5 seeded test transactions (+ their acknowledgments), rename the two placeholder bank accounts, upsert 15 new categories, set two fund opening balances.
- **Row-level mapping rules:** full category-mapping table per entity/fund/flow, skip rules (zero-amount VOIDED/cancelled checks, the pre-FY2025-window check #8022, the Foundation carryover row, the Admin opening-balance row, the 12/8/2025 Square $0.01 verification pair), party-derivation rule with two explicit overrides, payment-method rule, reconciled rule.
- **Verification target:** Foundation charitable-fund ending balance must equal $X,XXX.XX; Club (administrative + activity combined) must equal $XX,XXX.XX.

Full mapping table, skip rules, and opening balances are reproduced in the **Outputs** section below rather than duplicated here — see the script itself (`scripts/import-quicken-ledger.ts`), which is the executable source of truth and inlines the same rules as comments/code.

---

# Phase 4 — Implementation (full-stack-developer) — 2026-07-20

**Owner:** full-stack-developer
**Status:** complete

## Summary

Built and ran `scripts/import-quicken-ledger.ts`, a one-off tsx script that parses the two treasurer Quicken register CSVs (RFC4180-lite parser handling quoted fields with embedded commas, entity-specific column layouts, BOM), maps every row to a Foundation/Club fund + category per the user's spec, skips the rows called out in the spec, and seeds `ledger_transactions` accordingly. Dry-run reconciled exactly against both target balances on the first attempt; `--apply` ran cleanly, deleted the 5 seeded test transactions and renamed the placeholder bank accounts, upserted 15 new categories, set the two fund opening balances, and inserted 276 transactions (172 Foundation, 104 Club). Post-apply DB verification and a re-run of `--apply` (to confirm the delete-and-reimport idempotency path) both reconciled exactly.

## What I did

- Read both source CSVs in full (outside the repo, never copied in) to hand-verify every distinct register `Category` value against the user's mapping spec before writing code — confirmed 100% coverage, no unmapped categories, before touching the DB.
- Read `src/lib/db/schema.ts` (Ledger tables), `drizzle/migrations/0044_ledger_books.sql` (existing seeded categories/funds/entities/bank accounts, so upserts don't collide with what already exists), and `src/lib/ledger-queries.ts` (to confirm no read-path assumptions the import would violate — e.g. fiscal-year derivation from `txn_date`, `flow` being income/expense only).
- Confirmed via `psql` the exact 5 test transactions to delete (`Jane Doe`, `Quid Pro Quo Donor`, `Small Donor`, 2× a family-rate member's name) and the 2 acknowledgments referencing 2 of them, and the current placeholder bank-account names/entity IDs, and the treasurer's `users.id`.
- Wrote `scripts/import-quicken-ledger.ts`:
  - CSV parser: locates the header row by searching for `"Scheduled"`, builds a column-name → index map from the header itself (robust to the Administrative file's extra `Transfer` column vs. Foundation's 11-column layout), and stops at the closing `Balance:` line so the Total Inflows/Outflows/Net Total footer is never read as data.
  - Per-entity mapping functions (`mapFoundation`, `mapClub`) implementing the full category → (fund, category-name) table from the spec, including the flow-dependent branches (`Special Grant` income vs. expense; `Club Dues`/`New member fee` income vs. expense; `Tailtwisting` income vs. the one expense/TXFR row; `Miscellaneous` income vs. expense with the Qdoba exception).
  - Skip functions (`shouldSkipFoundation`, `shouldSkipClub`) covering: zero-amount rows (catches all VOIDED checks + the cancelled check #8045 in one generic rule), the Foundation carryover row, check #8022, the Square-verify $0.01 pair (matched by memo text, not amount, to avoid false-positives), and the Admin opening-balance row.
  - Party derivation (`deriveParty`) per the Payee-fallback rule, plus the two explicit overrides (7/8/2024 rows on both sides of the inter-entity tailtwisting transfer).
  - Payment-method and reconciled derivation exactly per spec.
  - A verification block that computes Foundation/Club ending balances from the in-memory mapped rows and refuses to touch the DB (exits 1) if either target balance doesn't reconcile exactly.
  - The `--apply` path wraps everything in a single `db.transaction(...)` (the project's driver is `postgres-js`, which supports real transactions, unlike a Neon-HTTP driver) so a mid-run failure rolls back cleanly rather than leaving a half-seeded ledger.
  - Post-apply, re-queries the DB directly (not the in-memory numbers) and re-asserts both target balances — this is the real proof the data landed correctly, independent of the script's own bookkeeping.
- Ran `pnpm exec tsc --noEmit` — clean.
- Ran the script dry-run (no `--apply`) — **reconciled exactly on the first attempt**, no mapping bugs found.
- Ran `--apply` — succeeded; confirmed via direct `psql` queries against the DB.
- Re-ran `--apply` a second time to confirm the idempotent delete-and-reimport path (deleted the 276 previously-imported rows, re-inserted 276, reconciled identically) — this is the safety property the spec required ("delete-and-reimport-safe").

## Outputs

- **Created:** `/Users/cshenso/git/westervillelions/scripts/import-quicken-ledger.ts` — the import script (no other files touched; no schema changes, no app code changes).
- **DB writes (via `--apply`, against the local Neon DB in `.env.local` — this is the user's local dev DB, not production; see project memory `feedback_local_db_is_neon`):**
  - Deleted 5 test `ledger_transactions` rows (`Jane Doe`, `Quid Pro Quo Donor`, `Small Donor`, 2× a family-rate member's name) and their 2 `ledger_acknowledgments` rows.
  - Renamed `ledger_bank_accounts`: club's placeholder → **"Administrative Checking"**, foundation's placeholder → **"Foundation Checking"**; `institution` set to `NULL` on both.
  - Upserted 15 new `ledger_categories` rows (all previously absent, all 15 created — 0 pre-existing collisions):
    - club/administrative expense: Insurance & bonding, Marketing, Web hosting, District & convention, Miscellaneous, Donations to Foundation
    - club/activity expense: Service projects
    - foundation/charitable expense: Scholarships, Fundraising event costs, Service projects, Operations, Insurance & bonding
    - foundation/charitable income: Rudolph Run, Pancake Breakfast, Fundraising events
  - Set `ledger_funds.opening_balance_cents`: club/administrative → the register's opening balance ($XX,XXX.XX); foundation/charitable → the register's opening balance ($XX,XXX.XX). Club/activity and foundation/scholarship left at $0 (no rows target them from either register).
  - Inserted **276 `ledger_transactions`** rows: **172 Foundation** (all `charitable` fund), **104 Club** (100 `administrative` + 4 `activity`). Every row's memo ends with ` [quicken-import]` (or is exactly `[quicken-import]` when the register memo was blank) — this is the idempotency marker; every `--apply` run first deletes all rows matching that marker, then re-inserts.
- **Category-mapping table used** (row category → target, by entity/fund/flow) — reproduced from the spec, all confirmed applied correctly:
  - **Foundation** (all rows → `charitable` fund):
    - → expense `Charitable donation out`: Philanthropic donation, Pilot Dogs, Ohio Lions Foundation, OLF Eye Care Fund, Ohio Lions Eye Research Foundation, Ohio Lions Pediatric Cancer Foundation, Lions Clubs International Foundation, Caring and Sharing, Camp Echoing Hills, Westerville Special Olympics, Student VOSH, Diabetes, Sensory Garden, Ohio State School for the Blind, Central Ohio Lions Eye Bank, BMX Sponsorship
    - → expense `Grant out`: Special Interest Grants, Boys State/Girls State, Special Grant (expense, except checks #8200/#8201 → `Disaster relief`)
    - → income `Grants received`: Special Grant (income row, the 8/29/2025 LCIF grant)
    - → expense `Scholarships`: High School Scholarships, Scholarships, BMX Race Scholarships
    - → expense `Fundraising event costs`: Rudolph Run Expenses, Pancake Breakfast Expenses, WinterFest
    - → income `Rudolph Run`: Rudolph Run Sponsorship, Rudolph Run Entry Receipts
    - → income `Pancake Breakfast`: Pancake Breakfast Receipts
    - → income `Fundraising events`: Restaurant fundraisers
    - → income `Public donations`: Cash Donation, Miscellaneous (income) — incl. the 7/8/2024 +$XXX tailtwisting transfer-in (party overridden to "Westerville Lions Club") and the 3/9/2026 $XX Zeffy test donation (payment_method overridden to `zeffy`)
    - → expense `Insurance & bonding`: Officer Bonding
    - → expense `Operations`: Miscellaneous (expense, except check #8245/Qdoba → `Charitable donation out`), Storage Unit, Uncategorized, Membership
    - → expense `Service projects`: Bags to Benches Expenses, Bench Plaques, Plastic Bags
  - **Club** (default `administrative` fund; `activity` fund overrides noted):
    - → **activity** income `Pancake Breakfast`: Pancake Breakfast Receipts (the one 3/17/2025 row)
    - → **activity** income `Public donations`: Donation (the two rows, an individual donor + Winterfest)
    - → **activity** expense `Service projects`: Bags to Benches (the one 7/29/2025 row)
    - → administrative income `Club dues`: Club Dues, New member fee, International new member fee (income)
    - → administrative expense `Per-capita tax`: Club Dues, New member fee (expense — LCI/District payments)
    - → administrative income `Tail-twisting`: Tailtwisting (income)
    - → administrative expense `Donations to Foundation`: Tailtwisting (the one expense/TXFR row, 7/8/2024 −$XXX, party overridden to "Westerville Lions Club Foundation")
    - → administrative expense `Meals`: Meeting Hospitality
    - → administrative expense `Postage`: Mailbox rental
    - → administrative expense `Marketing`: Marketing
    - → administrative expense `Web hosting`: Web hosting
    - → administrative expense `District & convention`: District Convention
    - → administrative expense `Insurance & bonding`: Officer Bonding
    - → administrative expense `Miscellaneous`: Miscellaneous (expense), Lion L Support
    - → administrative income `Misc`: Meeting Space Rental (the $XXX COhatch refund), Uncategorized (the $XXX.XX PayPal transfer)
- **Skip rules applied** (11 rows total skipped, all matching the spec exactly):
  - Zero-amount rows (generic rule catches all of these in one check): VOIDED checks #8217, #8219, #8220, #8037 (Foundation); cancelled check #8045 (Foundation); VOIDED check #8011 (Club).
  - Foundation carryover row (7/1/2024, +$XX,XXX.XX) — folded into opening balance.
  - Foundation check #8022 (4/5/2024, −$X,XXX, pre-FY2025 window) — folded into opening balance.
  - Foundation Square-verification pair (12/8/2025, −$0.01 / +$0.01, matched by memo text `"Square verify"`/`"Square verify credit"` — the adjacent +$XX.XX "Square deposit" split row on the same date correctly imports normally as Rudolph Run income).
  - Club opening-balance row (6/30/2024, +$XX,XXX.XX, Payee="Opening Balance"/Category="Transfer") — folded into opening balance.

## Verification

**Dry-run (before `--apply`):**
```
Foundation: opening $XXXXX.XX + income $XXXXX.XX - expense $XXXXX.XX = $XXXX.XX  (target $XXXX.XX)  OK
Club (admin+activity): opening $XXXXX.XX + income $XXXX.XX - expense $XXXXX.XX = $XXXXX.XX  (target $XXXXX.XX)  OK
```
Reconciled exactly on the first attempt — no mapping/parsing bugs found during development (the CSVs were hand-verified against the spec category-by-category before the script was written, which paid off here).

**Post-apply DB verification (queried live from `ledger_transactions`/`ledger_funds`, not the script's in-memory numbers):**
```
Foundation Charitable fund DB balance: $XXXX.XX  (target $XXXX.XX)  OK
Club (Administrative + Activity) DB balance: $XXXXX.XX  (target $XXXXX.XX)  OK
```

**Idempotency re-run** (`--apply` run a second time): deleted the 276 previously-imported rows (matched by the `[quicken-import]` memo suffix), re-inserted 276, reconciled identically. Confirms the "delete-and-reimport-safe" property the spec required.

**Per-FY totals** (fiscal year computed via the same start-year convention as `src/lib/fiscal-year.ts` — `FY2025 = Jul 2025–Jun 2026`):
```
Foundation:
  FY2024: income $XX,XXX.XX  expense $XX,XXX.XX  net -$XX,XXX.XX
  FY2025: income $XX,XXX.XX  expense $XX,XXX.XX  net -$X,XXX.XX
Club:
  FY2024: income $X,XXX.XX  expense $X,XXX.XX  net $X,XXX.XX
  FY2025: income $X,XXX.XX  expense $X,XXX.XX  net -$X,XXX.XX
```
Note: the register data spans calendar Jul 2024–Jun 2026, which under this codebase's start-year FY convention is **FY2024 and FY2025** (not "FY2025/FY2026" as the task brief's parenthetical guessed) — `FY2026 = Jul 2026–Jun 2027` per `src/lib/fiscal-year.ts`, so the two full fiscal years actually covered by the data are FY2024 (Jul 2024–Jun 2025) and FY2025 (Jul 2025–Jun 2026). Flagging this explicitly since it diverges from the brief's illustrative labels — the balances and category math are unaffected either way.

**Treasurer-review flag list** (rows mapped to `Operations` / `Miscellaneous` / `Misc` — catch-all categories that may deserve more specific categorization later; 16 rows):
- Foundation → Operations (8): an individual member −$XX.XX (9/23/25, source cat "Miscellaneous"), Westerville North Self Storage −$XXX.XX (5/29/25, "Miscellaneous"), The J. C. Manny Co. −$XXX.XX (4/13/25, "Membership"), U.S. Postal Service −$XXX.XX (12/11/24, "Miscellaneous"), Ohio Attorney General −$XX.XX (8/1/24, "Miscellaneous"), Costco Wholesale −$XX.XX (7/31/24, "Uncategorized"), Home Depot −$XXX.XX (7/31/24, "Uncategorized"), Westerville North Self Storage −$XXX.XX (7/22/24, "Storage Unit")
- Club → Miscellaneous (6): Lions Clubs International −$XXX.XX (6/10/26), J. C. Manny Co. −$XXX.XX (5/19/26), Clintonville Coin Laundry −$XX.XX (5/4/26, source cat "Lion L Support"), an individual member −$XXX.XX (10/17/25), an individual member −$XX.XX (10/1/25), an individual member −$XXX.XX (9/23/25)
- Club → Misc (2): Transfer from PayPal +$XXX.XX (11/25/25, source cat "Uncategorized"), "Refund of rent from COhatch" +$XXX.XX (7/23/24, source cat "Meeting Space Rental")

**Rows whose original register category was `Uncategorized` or `VOIDED`** (3 imported + the VOIDED zero-amount rows already covered in the skip list above): Costco Wholesale −$XX.XX, Home Depot −$XXX.XX (both Foundation, "Uncategorized" → Operations), Transfer from PayPal +$XXX.XX (Club, "Uncategorized" → Misc).

## Open questions / handoff notes

- **No qa/analyst phase invoked** — this is a one-off data seed against the user's local dev DB, not a shipped feature with a UI flow to click through. If the user wants an independent second look, the natural check is: load `/admin/ledger` (both entities) in the browser and visually confirm the fund balances and category breakdowns match what's printed above.
- **16 rows flagged for treasurer categorization review** (the `Operations`/`Miscellaneous`/`Misc` catch-all list above) — these imported successfully and the books balance, but the treasurer may want to split some of them into more specific categories later (e.g., is the "Refund of rent from COhatch" really `Misc` income, or should it be a negative `Marketing` expense reversal?). This was explicitly requested as a flag list, not a blocker.
- **FY-label discrepancy noted above** — the data covers FY2024/FY2025 under this codebase's fiscal-year convention, not FY2025/FY2026 as the task brief's parenthetical assumed. No code or data issue, just worth knowing when eyeballing the admin ledger UI's FY selector.
- **Source CSVs remain outside the repo**, exactly as required — nothing under `~/Documents/Treasurer Transfer Documents 07-2024 to 06-2026/` was copied into the working tree or committed.
- **Nothing was committed.** Per instructions, this is a script-run-only task; `scripts/import-quicken-ledger.ts` is a new untracked file and the DB writes are already live in the local dev DB. Awaiting the user's explicit go-ahead before any `git add`/`git commit`.
- **Script left in place** at `scripts/import-quicken-ledger.ts` for potential re-runs (e.g., if the treasurer sends a corrected export later) — it's fully idempotent via the `[quicken-import]` memo marker.

---

# Phase 4b — `beneficiaryCause` taxonomy addition (full-stack-developer) — 2026-07-20

**Owner:** full-stack-developer
**Status:** complete

## Summary

Extended `scripts/import-quicken-ledger.ts` to stamp `beneficiaryCause` on every imported Foundation and club-activity **expense** row, using an exact payee/memo/category taxonomy supplied by the requesting session. Previously every imported row had `beneficiaryCause = NULL`, so `/members/impact`'s "Giving by Cause" breakdown collapsed everything into "Other community support." Re-ran the script (dry-run then `--apply`) against the local dev DB; reconciliation still passes exactly, zero unmatched public-fund expense rows, and independent SQL confirms the totals. No app code (`src/`) was touched — script + re-run only, per the task's explicit constraint (another session had uncommitted `src/` changes in flight).

## What I did

- Read both source CSVs **in full** (194 + 119 lines — small enough to review every row, not sample) to hand-verify every payee/memo/category combination against the supplied taxonomy before writing the mapping function, rather than guessing at exact string spellings.
- Added a `deriveCause()` function to the script: a priority-ordered rule list (payee/memo overrides checked before generic register-category fallbacks, since Foundation categories like "Philanthropic donation" and "Special Grant" are shared by many different beneficiaries and can only be disambiguated by payee/memo) implementing the 9-cause taxonomy: Vision & Eye Care, Youth & Education, Hunger & Basic Needs, Health & Disability, Disaster Relief, Lions International Programs, Community & Civic, Bags to Benches (Recycling), Fundraising event costs.
- Added `beneficiaryCause: string | null` to the `MappedTxn` type; computed at row-build time, gated to `flow === "expense" && fundKind in (charitable, activity)` — administrative-fund rows and all income rows are left `null` unconditionally, per spec.
- Wired `beneficiaryCause` into the `--apply` insert payload.
- Added `printCauseReport()`: prints per-cause dollar/row totals plus two distinct buckets — genuinely **unmatched** public-fund expense rows (would indicate a taxonomy gap) vs. **deliberately null** rows (categoryName `Operations` or `Insurance & bonding`, which the spec explicitly excludes). Wired into the existing dry-run report output.
- Ran a **dry-run first** — reconciliation passed exactly ($X,XXX.XX / $XX,XXX.XX) and 0 unmatched rows on the first attempt, because every row had already been hand-verified against the CSVs.
- Hit a schema/DB mismatch on the first `--apply` attempt: `ledger_categories.counts_as_giving` (an uncommitted `schema.ts` column from the other in-flight session, per the task's warning) wasn't yet present on the local DB at that moment, and the transaction rolled back cleanly (confirmed via `psql` — transaction count unchanged before/after). By the time I checked, the column already existed (the other session's `db:push` had landed concurrently) — added nothing myself beyond confirming via `\d ledger_categories`, then retried `--apply`, which succeeded.
- **Did not touch any `src/` file** — confirmed via `git diff src/lib/db/schema.ts` that the only relevant unstaged change was the `countsAsGiving` column addition (unrelated to this task; the script doesn't reference it).
- Verified post-apply via **independent SQL** (not the script's own numbers): per-cause `SUM`/`COUNT` grouped over the exact giving predicate (`flow='expense' AND transfer_group_id IS NULL AND status='posted' AND fund.kind IN ('activity','charitable','scholarship')`), and a second query confirming the 9 null-cause rows are exactly the 7 `Operations` + 2 `Insurance & bonding` rows — both queries matched the script's dry-run output to the penny.
- Ran `pnpm exec tsc --noEmit` — clean (exit 0).

## Outputs

- **Modified:** `/Users/cshenso/git/westervillelions/scripts/import-quicken-ledger.ts` — added `deriveCause()`, `CAUSE_*` constants, `NO_CAUSE_CATEGORY_NAMES`, `ci()` helper, `printCauseReport()`, `beneficiaryCause` field on `MappedTxn` and the insert payload. No other files touched.
- **DB writes** (local dev DB, `--apply`, idempotent re-run of the existing `[quicken-import]` seed): re-deleted and re-inserted the same 276 `ledger_transactions` rows, now with `beneficiary_cause` populated on all Foundation + club-activity expense rows per the taxonomy below. No schema change made by this task (the one column gap encountered belongs to the other in-flight session, not this one).
- **No new env var, no new `FEATURES` entry** — pure data-seed extension.

### Final per-cause dollar table (independent SQL, matches script dry-run exactly)

| Cause | Rows | Dollars |
|---|---|---|
| Youth & Education | 14 | $XX,XXX.XX |
| Fundraising event costs | 33 | $XX,XXX.XX |
| Hunger & Basic Needs | 9 | $XX,XXX.XX |
| Vision & Eye Care | 15 | $XX,XXX.XX |
| Disaster Relief | 2 | $X,XXX.XX |
| Health & Disability | 8 | $X,XXX.XX |
| Lions International Programs | 4 | $X,XXX.XX |
| *(null — Operations/Insurance, deliberate)* | 9 | $X,XXX.XX |
| Community & Civic | 1 | $XXX.XX |
| Bags to Benches (Recycling) | 7 | $XXX.XX |

(102 total public-fund expense rows across Foundation + club-activity combined; not directly comparable to the Foundation-only reconciliation figure below, which is scoped to the Foundation entity's charitable fund only.)

**Reconciliation after re-import:** Foundation Charitable fund DB balance $X,XXX.XX (target $X,XXX.XX) — OK. Club (Administrative + Activity) DB balance $XX,XXX.XX (target $XX,XXX.XX) — OK. Both confirmed via the script's own post-apply DB verification and independently via `psql`.

**Unmatched public-fund expense rows: 0.** Every row eligible for a cause (Foundation any category + club-activity expense) matched a taxonomy rule or fell into the deliberate-null Operations/Insurance set.

## Judgment calls

- **Category `"Sensory Garden"` (standalone, line 88 of the Foundation CSV — Ohio Lions Foundation, −$XXX, 6/20/2025, no memo)**: the supplied taxonomy only explicitly covered "Ohio Lions Foundation rows whose *memo* mentions sensory garden" (matching line 18, the 3/7/2026 −$XXX row with memo "Lions sensory garden"). This row instead carries the register category `"Sensory Garden"` itself with no memo. Treated it as Vision & Eye Care by direct category match — same payee, same $XXX amount as the memo-tagged sibling row, clearly the same annual sensory-garden pledge, just categorized differently by the treasurer in that fiscal year. Flagging in case the treasurer intended something else by using a distinct category string.
- Everything else matched the supplied taxonomy unambiguously after reading every row in both CSVs — no other judgment calls were needed; all 102 eligible rows were traceable to an explicit rule in the brief (payee, category, or memo condition).

## Open questions / handoff notes

- **No qa/analyst phase invoked** — same rationale as Phase 4/5/6 above: this is a data-seed extension against the local dev DB, not a shipped feature with its own UI flow. The natural manual check is loading `/members/impact` in the browser and confirming "Giving by Cause" now shows the 9 named causes instead of a single "Other community support" bucket (note: the impact page's `getPhilanthropy`/`isGiving` predicate may exclude some of these rows depending on how the other in-flight session's `counts_as_giving` column and Phase-3-referenced "DECISION-030" ultimately get wired up — that's out of scope here and untouched by this task).
- **`counts_as_giving` column**: encountered as a pre-existing (uncommitted, in-flight) `schema.ts` change from another session while `--apply` was running; the local DB already had the column by the time of inspection (the other session's `db:push` landed concurrently). Nothing in this task added, migrated, or otherwise touched that column — noting it here only because it caused a transient `--apply` failure (cleanly rolled back) that resolved itself without action.
- Source CSVs remain outside the repo, unchanged from Phase 4.
- Nothing committed — same as Phase 4, awaiting explicit go-ahead.

---

# Phase 4c — Production port + dues auto-post backfill (full-stack-developer) — 2026-07-20

**Owner:** full-stack-developer
**Status:** complete

## Summary

Two production data operations, both explicitly authorized by the treasurer. Task 1 ported the
hardened dev ledger data (276 `[quicken-import]` marker transactions, 15 dev-only categories, both
fund opening balances, both bank-account renames) into production via a new idempotent script,
`scripts/port-ledger-dev-to-prod.ts` — a data **port** by natural key, not a re-run of the original
Quicken CSV import. Task 2 backfilled 14 production `dues_payments` rows (2026-06-24 → 2026-07-03)
that predated the deployed dues-auto-post feature and had no linked `ledger_transactions` row, via
`scripts/backfill-dues-ledger.ts`, which mirrors `syncDuesCreate`'s row shape exactly. Both scripts
are dry-run-by-default, `--apply`-gated, and were run dry-run → reviewed → applied → independently
re-verified. Every verification number specified in the task matched exactly on the first attempt.

## What I did

- Read `src/lib/dues-ledger-sync.ts` (the `syncDuesCreate` row shape to mirror for the backfill) and
  `src/lib/db/schema.ts` (`ledgerEntities`, `ledgerFunds`, `ledgerCategories`, `ledgerBankAccounts`,
  `ledgerTransactions`, `duesPayments`) before writing either script.
- Queried both DEV (`psql` against the `.env.local` `DATABASE_URL`) and PRODUCTION (Neon MCP
  `run_sql`, project `tiny-fog-13725730`, branch `production`) directly to confirm current state
  before writing code: entities, funds, categories (all 45 dev / 30 prod, diffed by natural key),
  bank accounts, the treasurer's user row in both DBs, the 276 dev marker-row count, the
  7 existing production dues-ledger rows ($XXX total, all dated 2026-07-20 — confirmed these must
  be left untouched), and the 21 production `dues_payments` rows (7 linked, 14 unlinked, $X,XXX
  unlinked total) via a `LEFT JOIN ... IS NULL`.
- Confirmed via direct query that none of the 276 dev marker rows have `donor_id`,
  `transfer_group_id`, `approved_by_user_id`, `approved_at`, `board_minute`, or `rejection_reason`
  set, and that no `ledger_acknowledgments` reference them — simplifying the port to a
  straightforward natural-key remap with hard-fail guards if any of those had been set unexpectedly.
- Confirmed the canonical "giving" SQL predicate from `getPhilanthropy()` in
  `src/lib/ledger-queries.ts` (status='posted', transfer_group_id IS NULL, flow='expense', fund.kind
  IN (activity, charitable, scholarship), category.counts_as_giving IS NOT FALSE) to use as the
  exact verification query for per-cause totals, so the check exercises the same logic the impact
  dashboard uses rather than an ad hoc approximation.
- Wrote `scripts/port-ledger-dev-to-prod.ts` (dry-run default, `--apply` to write):
  - Connects to DEV via `DATABASE_URL` from `.env.local` (source, read-only) and to PRODUCTION via
    a required `PROD_DATABASE_URL` env var (target) — two independent `postgres`/Drizzle clients,
    never the shared `@/lib/db` singleton, so both DBs can be addressed in one process without
    collision. `PROD_DATABASE_URL` was passed inline on the command line for each invocation and
    never written to any file.
  - Maps by natural key exactly per the task spec: entity by slug, fund by (entity slug, fund
    slug), category by (entity slug, fund_kind, flow, name), bank account by entity (asserts
    exactly one per entity, throws otherwise), `recorded_by_user_id` → production's
    treasurer row (throws if absent).
  - Upserts missing categories (checked by natural key, not `ON CONFLICT` — the table has no unique
    constraint on the natural key), then syncs `counts_as_giving` on every matching production
    category to dev's value.
  - Updates fund opening balances, renames both bank accounts (institution → NULL).
  - Deletes production `ledger_transactions` rows matching the `[quicken-import]` memo suffix
    (idempotency — the delete predicate is the *only* predicate used, structurally incapable of
    touching a `dues_payment_id`-linked row or a non-marker row), then inserts the 276 remapped
    rows in batches of 50 inside a single `targetDb.transaction(...)`.
  - Hard-fails (aborts the whole transaction) if any source row unexpectedly carries a
    `donor_id`, `transfer_group_id`, or `dues_payment_id` — defense-in-depth beyond the pre-check.
  - Prints a full dry-run plan (categories to insert, fund balance deltas, bank renames, delete/
    insert counts) and the task's expected verification numbers before touching the DB.
  - Post-apply, re-queries PRODUCTION directly (fresh SQL via the raw `postgres` client, not
    Drizzle, not the script's in-memory numbers) for all five verification checks from the task.
- Wrote `scripts/backfill-dues-ledger.ts` (dry-run default, `--apply` to write):
  - Connects to PRODUCTION only via `PROD_DATABASE_URL` — explicitly does **not** touch dev, per
    the task's instruction that dev's `dues_payments` rows are test-era.
  - Mirrors `syncDuesCreate` step-for-step: resolves the Club entity (slug `club`), the
    Administrative fund, the "Club dues" income category (graceful null fallback, matching the
    source function), the production treasurer user, and derives `party` as
    `` `${firstName} ${lastName}`.trim() `` from `members` — same as the live auto-post path.
  - Selection query: `dues_payments LEFT JOIN ledger_transactions ON dues_payment_id LEFT JOIN IS
    NULL`, joined to `members` for names — the same shape the task specified. The unique constraint
    `ux_ledger_txns_dues_payment` makes the whole script naturally idempotent (a second run selects
    zero rows).
  - Inserts with the exact same field set as `syncDuesCreate` (`entityId`, `fundId`, `txnDate`,
    `flow: "income"`, `categoryId`, `amountCents`, `party`, `paymentMethod`, `status: "posted"`,
    `duesPaymentId`, `syncStale: false`, `recordedByUserId`) — no extra fields, no memo, no
    `bankAccountId`, matching the source function's omissions exactly so backfilled rows are
    indistinguishable from auto-posted ones except their `created_at` timestamp.
  - Prints the 14 rows (date, member name, amount, method) in the dry run, then the expected
    post-apply numbers with the register-predates-deposits explanation the task required.
- Ran `pnpm exec tsc --noEmit` — clean before either script touched the DB, and again after both
  files existed — exit 0 both times.
- Ran Task 1 dry-run → reviewed the plan (15 categories to insert including both "Insurance &
  bonding" rows, which do **not** pre-exist in production's base 30 — production's base category
  set never had that category at all, unlike what I initially mis-recalled from an earlier
  same-session read of the production category dump; re-verified via `encode(name::bytea,'hex')`
  on both DBs to rule out a hidden-whitespace/unicode false match before trusting the diff) → ran
  `--apply` → ran the script's own post-apply verification (all seven checks OK) → ran a fully
  independent second verification via Neon MCP `run_sql` (separate queries, not reusing the
  script's connection or logic) confirming the same numbers.
- Ran Task 2 dry-run (14 rows, $X,XXX.XX, matched the task's numbers exactly) → `--apply` → the
  script's own post-apply verification (all OK) — dues total $X,XXX.XX, overall club balance
  $XX,XXX.XX ($XX,XXX.XX historical + $X,XXX.XX dues), explanation printed per the task's
  requirement that exceeding the register's historical ending balance is expected here.

## Outputs

- **Created:** `/Users/cshenso/git/westervillelions/scripts/port-ledger-dev-to-prod.ts` — dev→prod
  ledger port script (dry-run default, `--apply`-gated, idempotent).
- **Created:** `/Users/cshenso/git/westervillelions/scripts/backfill-dues-ledger.ts` — production
  dues-ledger backfill script (dry-run default, `--apply`-gated, naturally idempotent via the
  unique constraint on `ledger_transactions.dues_payment_id`).
- **No schema change, no app code (`src/`) change, no new env var, no new `FEATURES` entry** — both
  scripts are one-off `scripts/*.ts` tooling, same shape as `scripts/import-quicken-ledger.ts`.
  `PROD_DATABASE_URL` is a runtime-only env var passed at invocation, not documented in
  `CLAUDE.md`'s env var list (not a deploy-time app env var).
- **Production DB writes (both via `--apply`, against Neon project `tiny-fog-13725730` / branch
  `production` — this IS the live production database):**
  - Task 1: upserted 15 `ledger_categories` rows; synced `counts_as_giving` to `false` on the 3
    overhead categories (Insurance & bonding ×2, Fundraising event costs, Operations); updated
    `ledger_funds.opening_balance_cents` for club/administrative ($0 → $XX,XXX.XX) and
    foundation/charitable ($0 → $XX,XXX.XX); renamed both `ledger_bank_accounts` rows
    ("Primary Checking" → "Administrative Checking" / "Foundation Checking", institution → NULL);
    inserted 276 `ledger_transactions` rows (0 deleted — first run). The 7 pre-existing live
    dues-auto-post rows were never touched by this script (structurally impossible — its delete/
    insert logic only ever targets `[quicken-import]`-marked rows).
  - Task 2: inserted 14 `ledger_transactions` rows with `dues_payment_id` set, backfilling the
    2026-06-24 → 2026-07-03 dues payments that predated the auto-post deploy.

## Verification (all against PRODUCTION, independently re-checked via Neon MCP after script apply)

```
Task 1:
  Marker rows: 276  (expected 276)  OK
  Dues rows (untouched): 7 / $XXX.XX  (expected 7 / $XXX.XX)  OK
  Club historical balance (excl. dues rows): $XX,XXX.XX  (expected $XX,XXX.XX)  OK
  Foundation historical balance (excl. dues rows): $X,XXX.XX  (expected $X,XXX.XX)  OK
  Per-cause totals: Youth & Education $XX,XXX.XX · Hunger & Basic Needs $XX,XXX.XX ·
    Vision & Eye Care $XX,XXX.XX · Disaster Relief $X,XXX.XX · Health & Disability $X,XXX.XX ·
    Lions International Programs $X,XXX.XX · Community & Civic $XXX.XX ·
    Bags to Benches (Recycling) $XXX.XX — all OK, all matched dev exactly
  counts_as_giving = false on exactly: Fundraising event costs, Insurance & bonding, Operations  OK

Task 2:
  Dues payments with no ledger row: 0  (expected 0)  OK
  Ledger dues total: 21 rows / $X,XXX.XX  (expected $X,XXX.XX)  OK
  Overall club balance: $XX,XXX.XX = $XX,XXX.XX historical + $X,XXX.XX dues  (expected $XX,XXX.XX)  OK
    (Register export predates these Zeffy/check deposits — exceeding the register's historical
    ending balance is expected, not an error.)

Independent re-check (Neon MCP, separate from either script's self-reported output):
  marker_count=276, dues_count=21, dues_sum_cents=250100, dues_missing_ledger=0,
  overhead_distinct_names=3 ("Fundraising event costs, Insurance & bonding, Operations"),
  bank accounts: club="Administrative Checking" (institution null),
  foundation="Foundation Checking" (institution null)
```

Everything matched on the first `--apply` attempt for both scripts — no loop-backs, no data
corrections needed.

## Open questions / handoff notes

- **`pnpm exec tsc --noEmit` passes** with both new scripts in the tree (confirmed after writing
  both files).
- **T-12 in `docs/treasurer-todo.md`** checked off with a 2026-07-20 outcome note per the file's
  append-don't-delete convention.
- **No qa/analyst phase invoked** — same rationale as Phase 4/4b: this is a one-time production
  data operation on existing, already-shipped Ledger infrastructure, not a new user-facing feature
  with a UI flow. The natural manual check, if the treasurer wants a visual second look: load
  `/admin/ledger` (both entities) and `/members/impact` in production and confirm the fund balances,
  category breakdowns, and "Giving by Cause" figures match the numbers printed above.
- **Nothing committed.** Both scripts are new untracked files; per instructions, awaiting the user's
  explicit go-ahead before any `git add`/`git commit`. The production DB writes are already live —
  distinct from the code, which remains uncommitted.
- **Scripts left in place** at `scripts/port-ledger-dev-to-prod.ts` and
  `scripts/backfill-dues-ledger.ts` — both are safe to re-run (fully idempotent) if needed, e.g. if
  dev's ledger data is corrected again later, or if more dues payments land before any future
  auto-post gap.
- **Follow-up not in scope for this task:** T-11 in `docs/treasurer-todo.md` (the two deleted test-data family dues rows) is unrelated to this port and remains open.

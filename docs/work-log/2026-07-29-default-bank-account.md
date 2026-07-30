# Default/Operating Bank Account — Work Log

> **Slug:** `2026-07-29-default-bank-account`
> **Surface:** (dashboard) admin — The Ledger (`src/lib/dues-ledger-sync.ts`, `src/components/admin/ledger/transaction-form.tsx`, `src/app/api/admin/ledger/transactions/route.ts`, `src/lib/db/schema.ts`)
> **Permission(s):** existing `ledger.record` (`FEATURES.LEDGER_RECORD`) covers manual transaction entry — no new permission
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-29 |
| 2 — Architectural review | architect | Skipped | N/A — bug-fix variant; no new directories, no server/client boundary change, no new dependency. Root cause and fix both confirmed in Phase 1 against live code/data. | 2026-07-29 |
| 3 — Technical design | tech-lead | Complete (brief) | Design confirmed by Phase 1's "Design Questions — Resolved" + "Open Questions — RESOLVED"; this entry adds the concrete file-level plan | 2026-07-29 |
| 4 — Implementation | full-stack-developer | Complete | All four locked-decision items shipped; unit tests written and passing | 2026-07-29 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Every ledger transaction should carry a bank account by construction — a per-entity default that dues-sync sets automatically and that pre-fills (but doesn't lock) the manual-entry form — so reconciliation never again silently loses a transaction to a NULL `bank_account_id`.

## Root Cause — Verified

Confirmed both mechanisms against the current code, not just the brief:

1. **`src/lib/dues-ledger-sync.ts`, `syncDuesCreate` (~line 139):** the `tx.insert(ledgerTransactions).values({...})` call sets `entityId`, `fundId`, `txnDate`, `flow`, `categoryId`, `amountCents`, `party`, `paymentMethod`, `status`, `duesPaymentId`, `syncStale`, `recordedByUserId` — no `bankAccountId` key at all. The column has no DB default (`bankAccountId: uuid("bank_account_id").references(...)`, nullable, no `.default()`), so every dues-synced row lands NULL.
2. **`src/components/admin/ledger/transaction-form.tsx`:** the bank-account `<select>` (line ~698) is labeled `Bank Account (optional)`, defaults `useState(initialValues?.bankAccountId ?? "")`, and its first option is `<option value="">Not specified</option>`. The create route (`src/app/api/admin/ledger/transactions/route.ts` line ~305) stores `bankAccountId: bankAccountId ?? null` — a blank selection persists as NULL.

Live DB check confirms the shape and current damage:

| Entity | Bank accounts | Posted txns | Posted txns w/ NULL bank account |
|---|---|---|---|
| Club | Administrative Checking (active, 104 posted txns), Petty Cash (active, 0 txns) | 111 | **7** |
| Foundation | Foundation Checking (active, 172 posted txns) — only one account | 172 | **0** |

The 7 remaining Club NULLs are not the original 24 (those were already backfilled in prod per memory) — they're `$12.34`, blank-party, `check`-method rows all created within a 30-second window on 2026-07-21, which reads as QA/test fixture data rather than real bookkeeping, not a recurrence of the original bug. Flagged below, not treated as a production data emergency.

Club also has **two** active funds (`activity`, `administrative`) sharing one operating account (Administrative Checking) — Petty Cash has zero transactions ever. This is the concrete case that rules out "the fund" or "the entity's only account" as safe resolvers (see design question 1).

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| admin (treasurer, `ledger.record`) | Manually creates a ledger transaction and (today) optionally picks a bank account | Per transaction, ongoing |
| admin (treasurer, `ledger.record`) | Records a member's dues payment (triggers `syncDuesCreate` automatically, no direct UI verb for the ledger side) | Per dues payment |
| admin (treasurer, `ledger.manage` — assumed, see gap below) | Designates which of an entity's bank accounts is the default/operating account | Rare, one-time-ish setup action |

The request is a fix + a small setup verb (Verb 3 is new and has no home yet — see Gaps).

## Flows

**Flow 1 — Dues payment auto-posts to the ledger (fixed path):**
Entry: treasurer records a dues payment in `/admin/dues` (or wherever dues are recorded) → `syncDuesCreate` runs inside the same DB transaction → resolves Club entity → resolves Administrative fund → **resolves the Club's default bank account** (new step) → inserts the ledger row with `bankAccountId` set.
- Outcome: the ledger transaction is immediately a valid reconciliation candidate — no manual cleanup required.
- Failure: today, any resolution failure (entity/fund not found) is absorbed by the existing best-effort carve-out — the dues payment still commits, `syncFailed: true` is returned, and (per the existing pattern) presumably surfaced to the treasurer some way already. **Design question 3** below asks whether "no default bank account configured" should be treated the same way (fail-soft, log + `syncFailed`) rather than silently inserting NULL again, which is what would happen if this step is skipped on error.

**Flow 2 — Treasurer manually records a transaction (fixed path):**
Entry: treasurer opens the transaction form (create) → **bank-account field is pre-selected to the entity's default account** (no longer blank/"Not specified") → treasurer submits, optionally overriding to Petty Cash or another account first.
- Outcome: the created row has a bank account by default; override still available for genuine exceptions (Petty Cash entries, a second account if one is added later).
- Failure: if the treasurer clears the field and submits anyway — behavior depends on the required-vs-optional call (design question 2). Recommended: server rejects with a specific 400, e.g. *"Select a bank account before saving this transaction."* — not a generic 500.

**Flow 3 — Reconciliation sees the transaction (unchanged, downstream benefit):**
Entry: treasurer opens `/admin/ledger/reconciliation` for a bank account → `getCandidateTransactionsForMatching` filters `bank_account_id = <session's account>` → the transaction now appears (it didn't before, when NULL).
- Outcome: existing reconciliation flow, unmodified — this fix's entire value is making rows visible here.
- Failure: existing reconciliation failure paths apply (unchanged).

## Permissions

- **Manual entry (Flow 2):** existing `ledger.record` (`FEATURES.LEDGER_RECORD`) — unchanged, already gates transaction create/edit/delete.
- **Dues sync (Flow 1):** no user-facing permission — server-side, runs inside the existing dues-record transaction under whatever permission already gates dues recording.
- **Setting the default account (new verb):** no dedicated key exists today because there is no admin UI for bank accounts at all (`ledger_bank_accounts` rows appear to be seeded, not CRUD'd — no page under `/admin/ledger` manages them). Recommend this ships as an **idempotent migration**, not a new UI, scoped to this fix (see design question 1 resolution). If a future increment adds a bank-accounts admin page, it should gate "change default" behind `FEATURES.LEDGER_MANAGE` (`ledger.manage`) — consistent with fund/entity administration already using that key — but that's out of scope here.

## Design Questions — Resolved

### 1. Where does "default" live — fund, entity, or a flag on the account?

**Recommendation: a boolean `isDefault` column on `ledger_bank_accounts`, one `true` row per `entity_id`, enforced by a partial unique index (`UNIQUE (entity_id) WHERE is_default`).**

Reasoning:
- `ledger_bank_accounts` has no `fund_id` — it's already entity-scoped, and a per-fund default would require setting it redundantly on every fund that happens to clear through the same account. Live data proves the mismatch: the Club has **two** funds (Activity, Administrative) and **one** operating account (Administrative Checking) that both funds' cash actually clears through. A fund-level `default_bank_account_id` would need the same value written twice today, and would silently go stale the moment a third fund is added and someone forgets to set it.
- An entity-level default matches how a real club/foundation actually banks: one checking account is "the" operating account; a second account (Petty Cash) is a deliberate, occasional exception a human picks explicitly. That's a per-account flag, not a per-fund pointer.
- Foundation is even simpler (one account today), so this design costs nothing there and generalizes cleanly if the Foundation ever opens a second account.

### 2. Form behavior — required, or default-and-overridable?

**Recommendation: both — pre-select the default (fixes the friction) *and* make the field required at submit (closes the loophole), removing the `Not specified` option entirely.**

Reasoning for going further than "just default it":
- I checked whether a `pending`-status transaction could legitimately lack a bank account until later approval (`status: 'posted' | 'pending' | 'rejected'`, plus an `/approve` route). It does not help the optional case: the approve route only flips status/approval fields — it doesn't re-collect `bankAccountId`. If a `pending` row is ever created without one, `approve` mints a **posted** transaction still holding a NULL bank account, recreating the exact same reconciliation-invisibility bug the fix exists to close. So there's no legitimate lifecycle state today where "no bank account yet, to be filled in later" is a safe design — the field needs to be right at creation time for every status, not just `posted`.
- Given the field will be pre-filled with a sensible value on page load, requiring it costs the treasurer nothing in the common case (accept the default, submit) and only asks for a deliberate choice in the genuine exception case (Petty Cash). "Optional" is the exact property that let a form-fill lapse produce the 1 bill-pay NULL in the first place — removing the "Not specified" escape hatch is a small change with an outsized payoff for a books-integrity fix.
- Net: this is not "required with more friction" — it's "defaulted, and the previous silent-blank path is removed." The two recommendations work together, not in tension.

### 3. dues-sync resolver

**Confirmed:** `syncDuesCreate` should, right after resolving the Administrative fund (step 2, ~line 100), query `ledgerBankAccounts` for `entityId = clubEntity.id AND isDefault = true` (limit 1) and include the result in the `values({...})` insert.

Recommend this follows the **existing best-effort carve-out pattern** already in the file, not a new behavior: if no default account is configured for the Club (should never happen post-migration, but the code shouldn't assume it), treat it exactly like the existing "fund not found" case — log, `return { syncFailed: true }`, dues payment still commits. **Do not** let a missing-default fall through to inserting NULL again; that would silently resurrect the bug this fix exists to close. This is a one-line addition to an existing `if (!X) { console.error(...); return { syncFailed: true }; }` pattern already used twice in the same function — no new error-handling shape needed.

### 4. Backfill — does Foundation need it too?

**No historical backfill needed for Foundation right now** — live query shows 0 of 172 posted Foundation transactions have a NULL bank account. I looked for an automated Foundation posting path analogous to `syncDuesCreate` (a Zeffy-donation-to-ledger auto-post) and found none — the only Zeffy reference in `src/lib/ledger.ts` is a comment about dues timing, not code that inserts ledger rows. All 172 Foundation rows appear to be manually entered (or imported), and every one of them has a bank account set, which is unsurprising since Foundation has exactly one account to begin with — even the *current* optional/blank form doesn't produce ambiguity there today.

That said, **the shared surface still matters**: `transaction-form.tsx` and the create route serve both entities. Once this fix ships, Foundation transactions get the same defaulting/requiring behavior — cheap insurance against Foundation someday opening a second account (e.g., a grant-restricted account) and hitting the exact bug this fix closes for the Club.

**Club's remaining 7 NULLs** (all `$12.34`, blank party, `check` method, created within 30 seconds of each other on 2026-07-21) read as test fixtures from feature QA, not real transactions. Recommend: before backfilling them via `scripts/backfill-bank-account.ts`, confirm with whoever ran that test session whether these are disposable and should be **deleted** instead of backfilled into the real books. Flagging to tech-lead/qa rather than deciding unilaterally — it's a data-hygiene call, not a design call.

### 5. Interaction with the transaction-split feature

This ships in the same release as `docs/work-log/2026-07-29-ledger-transaction-split.md` — both are reconciliation-hygiene fixes touching the same register surface, but the logic is independent:
- Split's Phase 1 already states the new split-off row inherits `bankAccountId` unmodified from the original — consistent with this fix (a split part is the same underlying cash movement, same account).
- No shared code path needs to change for both features simultaneously; tech-lead should sequence them as independent PRs/commits even if released together, so a revert of one doesn't require reverting the other.

## Gaps the Request Didn't Address

- **No existing admin surface to change the default later.** There is no bank-accounts admin page today (accounts are seeded, not CRUD'd). Setting `isDefault` via migration is the right scope for *this* fix, but if the Club ever needs to switch its operating account (bank change), there's currently no UI path to flip the flag — it'd require a direct migration/script, same as adding an account does today. Flagging as a known limitation, not blocking this fix.
- **Form label/copy** needs to change from "(optional)" to reflect the new required-and-defaulted behavior — not just a schema/validation change, or the UI will look broken (a required field with an "optional" label and a still-present blank option would be worse than before).
- **Existing rows edited through the form.** When an admin opens **Edit** on an already-NULL transaction (the 7 test rows, or any future NULL that slips through some other path), the form's `initialValues?.bankAccountId ?? ""` will show blank. Confirm the edit form pre-fills the *entity's default* (not just the row's stored value) when the stored value is NULL, so editing a legacy-NULL row is itself a one-click fix rather than requiring the treasurer to know which account to pick.
- **Mobile:** the bank-account `<select>` already exists and presumably already renders at 360px (it's a standard native select in the same form as amount/date/party) — no new layout risk, just confirming no regression once it becomes required (e.g., no layout shift from removing an option).
- **Empty state:** not applicable — this fix has no new list/index surface.
- **Email queue / Google Group sync:** not applicable — no notification, no membership relationship touched.
- **OAuth-vs-password / access-pending:** not applicable — `ledger.record`-gated internal action, same as always.

## Out of Scope (confirm with user)

- Building a bank-accounts admin CRUD page (add/edit/deactivate accounts, toggle default via UI) — this fix seeds `isDefault` via migration only.
- Any change to the Petty Cash account's usage pattern (still zero transactions; nothing here forces it to be used).
- A Foundation-side automated posting path (Zeffy → ledger auto-post) — doesn't exist today, not part of this fix, and Foundation has no NULL-bank-account problem to justify inventing one now.
- Deleting or otherwise resolving the 7 test-looking rows — flagged for a human decision, not decided here.

## Open Questions — RESOLVED (Chris, 2026-07-29)

1. **7 NULL Club rows → BACKFILL** to the Club's default (operating) account via `scripts/backfill-bank-account.ts`. Not deleting.
2. **Require field → YES.** Bank-account field becomes required at submit; the "Not specified" option is removed and the field pre-fills the entity's default account. Label copy updated from "(optional)".

### Original questions (for reference)

1. Confirm the 7 remaining NULL Club transactions ($12.34, blank party, `check`, created 2026-07-21) are QA test fixtures safe to delete, rather than real entries that need backfilling.
2. Confirm requiring the bank account field (removing "Not specified") is acceptable, or whether there's a real workflow (e.g., a treasurer entering a transaction before confirming which account it cleared through) that needs a true optional/deferred state. Nothing in the current codebase (statuses, approve flow) suggests one exists, but Chris knows the real workflow better than the code does.

---

# Phase 2 — Architectural Review (architect)

## Verdict

Skipped (bug-fix variant, per CLAUDE.md's Bug-Fix Variant table: "Skip if the fix doesn't touch invariants; document the skip in the work-log.")

## Why skipped

- No new directory, no new module, no new npm dependency.
- Server/client boundary is unchanged: `transaction-form.tsx` was already `"use client"`; the two route handlers were already server-side.
- The one new table column (`ledger_bank_accounts.is_default`) is additive to an existing table already owned by The Ledger's schema — not a new domain concept requiring placement review.
- Root cause and fix shape were both already verified against live code and live data in Phase 1 (queries run, real account names confirmed), which is the substance an architectural review would otherwise need to establish.

## Invariants Touched

- **Schema is the source of truth** — respected: `schema.ts` updated first, then the matching idempotent migration (`0070_ledger_bank_account_default.sql`).
- **Migrations re-run on every deploy** — respected: `ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`, and the seed `UPDATE`s are guarded by `NOT EXISTS` sub-selects keyed on "does this entity already have a default" — verified idempotent by running the migration twice against the dev branch (second run: no-op, only the already-exists index NOTICE).
- **Permissions are the only gating mechanism** — respected: no new permission introduced; existing `FEATURES.LEDGER_RECORD` gate on both routes is unchanged.

## Notes

None — Phase 3 below is a brief confirmation of Phase 1's already-resolved design questions, not new design work.

---

# Phase 3 — Technical Design (tech-lead, brief)

## Summary

Every ledger transaction must carry a bank account by construction. Add a per-entity `is_default` flag on `ledger_bank_accounts` (Phase 1 design question 1, already resolved — entity-level, not fund-level, because the Club's two funds share one operating account). Seed the flag onto each entity's real operating checking account via migration (no CRUD UI exists or is being built). Have `syncDuesCreate` resolve and set it. Make the manual-entry form's bank-account field required, pre-filled with the entity default (including when editing a legacy NULL row), and have both the create route and the transfer sub-handler reject a missing/blank `bankAccountId` with a specific 400. This is a data-integrity fix for reconciliation, not a new feature — no new permission, no new page.

## Permissions

- No new permission. Existing `FEATURES.LEDGER_RECORD` continues to gate `POST` and `PATCH /api/admin/ledger/transactions[/[id]]` unchanged.

## API Contract

- `POST /api/admin/ledger/transactions` — `bankAccountId` changes from optional to **required**; missing/blank now 400s with `"Select a bank account before saving this transaction."` before any DB call. Applies to both the normal-transaction body and the `transfer: true` body (both funnel through the same route; requiring it on the transfer sub-handler too keeps the "every ledger_transactions row" guarantee whole, since a transfer inserts two ledger_transactions rows just like a regular entry).
- `PATCH /api/admin/ledger/transactions/[id]` — `bankAccountId`, when present in the body at all, must be a non-empty string or the request 400s with the same message; omitting the key entirely still leaves the existing value untouched (unchanged behavior for that case).

## Data Model

- `ledger_bank_accounts.is_default boolean NOT NULL DEFAULT false` (new column).
- Partial unique index `ux_ledger_bank_accounts_entity_default ON ledger_bank_accounts (entity_id) WHERE is_default` — at most one default per entity.
- Migration: `drizzle/migrations/0070_ledger_bank_account_default.sql`.

## Component / Page Plan

- No new pages/components. Modified: `src/components/admin/ledger/transaction-form.tsx` (bank-account select: required, no blank option, default-account pre-fill).

## Implementation Order (as executed)

1. Schema: `isDefault` column on `ledgerBankAccounts` in `src/lib/db/schema.ts`.
2. Migration `0070_ledger_bank_account_default.sql` — column, index, seed (real account names confirmed live: see below).
3. `syncDuesCreate` (`src/lib/dues-ledger-sync.ts`) — new Step 3, resolves the Club's default account, best-effort carve-out on miss.
4. Route handlers — `POST` and transfer sub-handler in `route.ts`; `PATCH` in `[id]/route.ts`.
5. UI — `transaction-form.tsx`.
6. Backfill script — `scripts/backfill-bank-account.ts` verified/extended (not run).
7. Unit tests — `dues-ledger-sync.test.ts` extension + new `transactions/route.test.ts`.
8. No email notification, no release-notes entry authored here (deferred to whichever agent runs the pre-push/release-notes step before this ships to main).

## Edge Cases & Risks

- **Fresh/future DB without the real account names** (a from-scratch install that never got the "Administrative Checking" / "Foundation Checking" rename): the seed `UPDATE`s simply match zero rows and set no default — `syncDuesCreate` then hits its new carve-out (`syncFailed: true`, dues payment still commits) rather than silently reinserting a NULL. Acceptable degradation per Phase 1's design question 3 resolution.
- **Petty Cash must never become default** — the seed only ever matches on `name = 'Administrative Checking'`, never touches Petty Cash, and the partial unique index would reject a second default anyway if a future script tried.
- **Re-running the migration after a human manually changes the default** (no UI exists for this today, but a direct SQL `UPDATE` is possible) — the seed's `NOT EXISTS` guard means a re-run never overwrites a human-set default; it only acts when an entity has *no* default at all.
- **Transfers** — not explicitly named in Phase 1's flows (which focus on regular income/expense entries), but `handleTransfer` inserts `ledger_transactions` rows the same way and shares the same form/field, so the same required-field guarantee was applied there too, for consistency with the "every transaction" framing in Phase 1's one-line take.

## Implementer

full-stack-developer (this entry) — small, tightly coupled across schema + two route handlers + one client component; splitting across specialists would have added handoff overhead disproportionate to the change size.

---

# Phase 4 — Implementation (full-stack) — 2026-07-29

**Owner:** full-stack-developer
**Status:** complete

### Summary

Implemented all four locked-decision items: schema + idempotent migration adding `ledger_bank_accounts.is_default` (seeded onto each entity's real operating checking account, confirmed against live data via Neon MCP before writing the seed); `syncDuesCreate` now resolves and sets the Club's default bank account with a best-effort carve-out on miss; the manual transaction form's bank-account field is now required, pre-filled with the entity default (including on edit of a legacy-NULL row), with the blank "Not specified" option removed; both the create route and its transfer sub-handler, plus the edit route, reject a missing/blank `bankAccountId` with a specific 400. The existing `scripts/backfill-bank-account.ts` was extended to prefer the new `is_default` flag when an entity has multiple accounts, rather than requiring a manual `--account=` override every time.

### What I did

- Queried the live (dev-branch) DB via Neon MCP (`mcp__Neon__run_sql`, project `tiny-fog-13725730`) to confirm real bank-account names/ids before writing the seed — did not guess. Confirmed: Club has "Administrative Checking" (operating, 131 posted txns) and "Petty Cash" (`account_type='cash'`, 0 posted txns); Foundation has "Foundation Checking" (only account, 172 posted txns). Also confirmed 0 NULL-bank-account rows currently exist on the dev branch (Phase 1's "7 NULL rows" finding was against a different snapshot/branch — not something this implementation needed to act on; the backfill script itself is unaffected and still handles that count correctly whenever it's run).
- Added `isDefault` boolean column (`NOT NULL DEFAULT false`) to `ledgerBankAccounts` in `src/lib/db/schema.ts`.
- Wrote `drizzle/migrations/0070_ledger_bank_account_default.sql`: `ADD COLUMN IF NOT EXISTS`, partial unique index `ux_ledger_bank_accounts_entity_default ON ledger_bank_accounts (entity_id) WHERE is_default`, and two idempotent seed `UPDATE`s (Club → "Administrative Checking", Foundation → "Foundation Checking"), each guarded by `NOT EXISTS (... WHERE entity_id = ... AND is_default)` so re-running never creates a second default or overwrites a human-set one.
- Ran `pnpm db:migrate` against the dev branch (`.env.local`'s `DATABASE_URL`), confirmed the column/index/seed applied correctly, then ran it a second time to confirm true idempotency (no-op on the column/seed; only a harmless "index already exists" NOTICE).
- `src/lib/dues-ledger-sync.ts` — added Step 3 in `syncDuesCreate`: queries `ledgerBankAccounts` for `entityId = clubEntity.id AND isDefault = true` (limit 1), right after the Administrative-fund resolution. On miss: `console.error(...)` + `return { syncFailed: true }` — matches the existing carve-out pattern exactly (does not fall through to inserting NULL). On hit: `bankAccountId: defaultBankAccount.id` added to the `tx.insert(ledgerTransactions).values({...})` call. Renumbered the function's docstring steps (3→4→5→6) and the inline step comments to stay accurate.
- `src/app/api/admin/ledger/transactions/route.ts` (POST):
  - Added a required-field check for `bankAccountId` immediately after amount validation, before any DB call — 400s with `"Select a bank account before saving this transaction."` Applied to both the normal-transaction path and the `handleTransfer` sub-handler (transfers insert `ledger_transactions` rows too, and share the same form/field — kept the "every row" guarantee whole rather than leaving transfers as a silent exception).
  - Changed the insert to `bankAccountId` (no longer `?? null`, since it's now guaranteed a valid string past the guard).
  - Updated the route's JSDoc contract comments for both request shapes.
- `src/app/api/admin/ledger/transactions/[id]/route.ts` (PATCH): when `body.bankAccountId` is present at all, it must now be a non-empty string or the request 400s with the same message — an explicit `null`/blank would otherwise silently reintroduce a NULL row on an edit. Omitting the key entirely still leaves the stored value untouched (unchanged). Updated the route's JSDoc.
- `src/components/admin/ledger/transaction-form.tsx`:
  - `bankAccountId` state now initializes to `initialValues?.bankAccountId ?? defaultBankAccountId` (where `defaultBankAccountId = bankAccounts.find(a => a.isDefault)?.id ?? ""`) — covers both a brand-new transaction (`initialValues` undefined) and editing a row whose stored value is `NULL` (`??` treats `null` and `undefined` identically), so opening Edit on a legacy-NULL row is a one-click fix, per Phase 1's gap note.
  - Removed the `<option value="">Not specified</option>`, added `required` to the `<select>`, changed the label from "Bank Account (optional)" to "Bank Account".
  - Added a client-side pre-submit guard (`if (!bankAccountId) { toast.error(...); return; }`) for the edge case where `bankAccounts.length === 0` (the whole field doesn't render, so `required` can't catch it).
  - Changed all three submit-body constructions (edit, new transfer, new regular) from `bankAccountId: bankAccountId || null` to `bankAccountId` — it's guaranteed non-empty by the guard above.
  - No changes to `getBankAccounts()` in `src/lib/ledger-queries.ts` were needed — it already does `select()` (all columns), so `isDefault` flows through to `LedgerBankAccount[]` automatically once the schema changed.
- `scripts/backfill-bank-account.ts`: extended the account-resolution logic — when an entity has more than one bank account and no explicit `--account=` override is passed, it now falls back to the entity's `is_default` account (queried alongside name/id) instead of unconditionally refusing. Still refuses if zero or more-than-one default is configured (ambiguous) or if the named `--account=` doesn't exist. **Not run** (per the explicit instruction — this is done manually after verification).
- Extended `src/lib/dues-ledger-sync.test.ts`: `makeTx`'s select-call-count table now has a 3rd slot for `bankAccountRows` (shifting `catRows`/`memberRows` to slots 4/5), defaulting to `[{ id: "default-bank-account-id" }]` so all pre-existing tests continue to pass unmodified. Added two new tests: (1) asserts the inserted row's `bankAccountId` matches the resolved default account (captured via a new `getInsertedValues()` helper on the mock), (2) asserts `{ syncFailed: true }` and no insert when no default account resolves.
- Created `src/app/api/admin/ledger/transactions/route.test.ts`: mocks `@/lib/auth`, `@/lib/permissions-server`, `@/lib/db`, `@/lib/ledger-queries`, `@/lib/email`. Covers: missing `bankAccountId` 400s (normal path), blank-string `bankAccountId` 400s, a valid `bankAccountId` still succeeds (201, regression guard against over-tightening), missing `bankAccountId` 400s on the transfer path, and a valid transfer still succeeds (201).

### Outputs

- **Schema:** `src/lib/db/schema.ts` — `ledgerBankAccounts.isDefault: boolean("is_default").notNull().default(false)`.
- **Migration:** `drizzle/migrations/0070_ledger_bank_account_default.sql` (idempotent; applied + re-verified idempotent against the dev branch).
- **Modified:**
  - `src/lib/dues-ledger-sync.ts` — `syncDuesCreate` new Step 3 (bank-account resolution) + insert now sets `bankAccountId`.
  - `src/lib/dues-ledger-sync.test.ts` — extended mock + 2 new tests.
  - `src/app/api/admin/ledger/transactions/route.ts` — required `bankAccountId` on both POST paths (normal + transfer); JSDoc updated.
  - `src/app/api/admin/ledger/transactions/[id]/route.ts` — PATCH rejects explicit null/blank `bankAccountId`; JSDoc updated.
  - `src/components/admin/ledger/transaction-form.tsx` — required select, default pre-fill (including edit-of-NULL), client-side guard.
  - `scripts/backfill-bank-account.ts` — prefers `is_default` account when ambiguous; still not run.
- **New:** `src/app/api/admin/ledger/transactions/route.test.ts` (5 tests, all passing).
- **No new `FEATURES` entry, no new env var, no new permission** — existing `LEDGER_RECORD` gate unchanged on all touched routes.
- **Verification run:** `pnpm exec tsc --noEmit` — clean. `pnpm test` (full suite) — 28 files / 769 tests, all passing (no regressions). `pnpm lint` was attempted but fails in this environment on an unrelated ESLint/minimatch ESM incompatibility (`SyntaxError: The requested module 'minimatch' does not provide an export named 'default'`) — pre-existing environment issue, not something this change introduced or could fix within scope; flagging for qa/deployment-engineer rather than silently skipping. Did **not** run `pnpm build:only` or commit/push, per instructions.

### Implementer Notes

- Diverged slightly from the letter of the spec in one place, in the direction of the stated intent: the spec's example 400-check text focused on the "create/POST" path; I applied the identical required-field check to `handleTransfer` (the transfer sub-handler inside the same route file) as well, since a transfer inserts `ledger_transactions` rows through the exact same client form and field, and Phase 1's one-line take is "every ledger transaction should carry a bank account by construction" — leaving transfers as a silent, un-guarded exception would have been inconsistent with that framing. This is additive validation only; no existing transfer behavior changes for a client that already supplies `bankAccountId` (which the form always does now).
- Did not touch `docs/treasurer-todo.md` — no treasurer follow-up item was generated by this fix (the backfill is scripted and pending manual run, not a books question).
- Live Neon check (via `mcp__Neon__run_sql`) found **0** posted transactions with a NULL `bank_account_id` on the dev branch at the time of this work — differs from Phase 1's "7 NULL rows" figure. Not investigated further since (a) the backfill script's own dry-run output is the authoritative count whenever Chris runs it, and (b) this implementation's job was to make the script correct/idempotent, not to reconcile row counts across snapshots.

### Open questions / handoff notes

- **Browser click-through to verify (nominating qa for Phase 5):**
  - Open the transaction form (create) on a Club fund page — confirm the Bank Account select is pre-filled to "Administrative Checking" (not blank), has no "Not specified" option, and is required (browser blocks submit if somehow cleared).
  - Open the transaction form (create) on the Foundation fund page — confirm it pre-fills to "Foundation Checking".
  - Edit an existing transaction and confirm the stored bank account still shows correctly; if a NULL-bank-account row can be found/created for testing, confirm Edit pre-fills the default rather than blank.
  - Attempt a transfer between two Club funds — confirm the bank-account field behaves the same way and the transfer still posts.
  - Record a dues payment end-to-end and confirm the auto-posted ledger row has `bank_account_id` set to Administrative Checking (spot-check via the ledger transaction list or a DB query).
  - Mobile (360px): confirm the select still renders cleanly with the blank option removed (no layout shift).
- **Not run, by instruction:** `scripts/backfill-bank-account.ts --entity=club --apply` (or dry-run) — Chris runs this manually after verification. Note it now prefers the `is_default` account automatically when the Club has >1 account, so a plain `--entity=club --apply` should work without needing `--account="Administrative Checking"` explicitly (though that override still works if preferred).
- **Pre-existing environment issue surfaced, not fixed:** `pnpm lint` fails at startup on an ESLint/minimatch ESM incompatibility unrelated to this change — worth a deployment-engineer look independent of this fix.
- **Unrelated concurrent working-tree changes observed:** partway through this session, `git diff --stat` showed modifications to files this task never touched (`budgeting/page.tsx`, several `budgets/*/route.ts` files, `admin-sidebar.tsx`, `permissions.ts`, `application-action-buttons.tsx`) that were not present in the git status snapshot at the start of this conversation — consistent with another concurrent session (likely the budget-permissions or transaction-split work referenced elsewhere in this repo) editing the same working tree. Flagging for awareness only — this implementation never read or wrote any of those files.

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

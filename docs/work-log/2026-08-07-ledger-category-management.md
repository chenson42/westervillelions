# Ledger Category Management (Settings) — Work Log

> **Slug:** `2026-08-07-ledger-category-management`
> **Surface:** (dashboard) admin — `/admin/ledger/settings`
> **Permission(s):** `FEATURES.LEDGER_MANAGE` (`ledger.manage`) — existing key, bound to Admin only (migration `0045_ledger_permissions.sql`). No new key.
> **Estimated complexity:** medium–large — destructive operations against live books
> **Pipeline mode:** Full — touches historical financial data

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-07 |
| 2 — Architectural review | architect | Complete | Approved | 2026-08-07 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-08-07 |
| 4 — Implementation | database-admin → api-developer → ux-developer | Complete | — | 2026-08-07 |
| 5 — Verification | qa | Complete | PASS | 2026-08-07 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-07 |
| 4 (loop-back) — merge lock-block | full-stack-developer | Complete | — | 2026-08-07 |
| 5 (loop-back, scoped to merge) | coordinator (gates only, not a full qa pass) | Complete | Gates green | 2026-08-07 |
| 6 (loop-back re-check) | analyst | Complete | SHIP WITH NOTES | 2026-08-07 |
| 4 (2nd loop-back) — merge prior-FY block | full-stack-developer | Complete | — | 2026-08-08 |
| 5 (2nd loop-back, scoped to merge) | coordinator (gates only, not a full qa pass) | Complete | Gates green | 2026-08-08 |
| 6 (2nd loop-back re-check) | analyst | Complete | SHIP IT | 2026-08-08 |

**Phase 6 → Phase 4 loop-back (2026-08-07):** the treasurer reviewed Phase 6's finding that merge
re-pointed locked prior-year budget rows (broader than the precedent scripts) and decided merge
must instead refuse the whole operation whenever any affected fiscal year is locked. See the
"Phase 4 — Implementation (merge lock-block loop-back)" section below for the fix, and
DECISION-067 in `docs/decisions.md` for the corrected decision record (supersedes DECISION-066
item 3). Next: qa re-verify scoped to merge, then a short analyst Phase 6 re-check.

**Phase 6 re-check → Phase 4 second loop-back (2026-08-08):** the analyst's Phase 6 re-check found
the lock-based guard above was vacuous in practice — no fiscal year has ever actually been locked
in this database, so the real `Awards`/`Supplies` merges (each now holding only a leftover FY2025
row) would still succeed by silently re-pointing an approved prior-year budget row, exactly what
DECISION-067 was written to prevent. The treasurer's follow-up decision: merge must refuse the
whole operation whenever any affected fiscal year is EARLIER than the current fiscal year,
regardless of lock status — both checks apply. See "Phase 4 — Implementation (merge prior-FY-block,
2nd loop-back)" below and DECISION-068 in `docs/decisions.md` (which also corrects DECISION-067's
closing claim in place, struck through with a cross-reference). Next: qa re-verify scoped to
merge, then a short analyst Phase 6 re-check.

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> The treasurer needs to rename, retire, and (occasionally) consolidate ledger categories from a UI instead of one-off SQL scripts — the request is one sentence, but the last two days of hand-run scripts already tell us almost exactly what "manage" has to mean, and where it gets dangerous.

## Evidence Read

- `scripts/merge-club-budget-categories.ts` — the only precedent for "merge." Both real merges (`Awards`→`Member recognition`, `Supplies`→`Program supplies`) had **zero transactions on the source category**. The script only ever re-points `ledger_budgets.category_id` for the current fiscal year; it never touches `ledger_transactions`. It refuses if the destination already has an FY2026 budget row ("resolve by hand"), and only checks the *current* fiscal year's lock (`ledger_budget_approvals`) before writing.
- `scripts/apply-fy2026-budget-review.ts` — the only precedent for "rename." Renamed Foundation `Program supplies` → `Bags to Benches` only after asserting, live, that every one of the 6 transactions ever posted to that category was tagged `beneficiary_cause = 'Bags to Benches (Recycling)'`. The rename touched a category whose FY2025 budget row is presumably locked (prior years are always closed) — the script did not check FY2025's lock status at all, only FY2026's, and deliberately let the FY2025 line relabel too ("which is exactly what Lori was looking for").
- `src/lib/db/schema.ts:578-602` — `ledgerCategories` columns confirmed: `entityId`, `fundKind`, `flow`, `name`, `form990Line` (nullable text, no format constraint), `sortOrder`, `isActive` (default `true`), `countsAsGiving` (default `true`), `createdAt`/`updatedAt`. **No actor column** (no `createdByUserId`/`updatedByUserId`), and **no DB-level unique constraint** on `(entityId, fundKind, flow, name)` — uniqueness is app-layer only (`validateCategoryCreateInput`, case-insensitive).
- FK behavior: `ledger_transactions.category_id` → `ledgerCategories.id` **ON DELETE SET NULL**; `ledger_budgets.category_id` → **ON DELETE SET NULL** too (`schema.ts:667`, `:807-808`). A hard delete on a category with any history silently blanks the category on every transaction/budget row that referenced it — no cascade block, no warning, just quiet data loss. This settles the delete-vs-deactivate question: **hard delete must not be exposed in the UI** for any category with references; `isActive=false` is the only safe "remove" operation.
- `isActive` is checked consistently everywhere categories are listed for a picker — `getCategories()` (`ledger-queries.ts:387-402`), the fund-kind category lookup (`:578-586`), and the budgeting page's per-kind lookup (`:4257-4265`) all filter `isActive = true`. **But it is never set to `false` anywhere in the current codebase** — the only writer of `ledgerCategories` today is `POST /api/admin/ledger/categories`, which always inserts `isActive: true`. This feature would be the first code path to ever exercise deactivation.
- `countsAsGiving` is read with `or(isNull(...), eq(..., true))` in the impact/giving aggregate queries (`ledger-queries.ts:4711`, `:4806`) — it directly controls what counts toward the all-time and per-cause totals shown on `/members/impact`. Flipping it retroactively changes those totals for every transaction already posted to the category, with no confirmation step today.
- `form990Line` drives the 990-line aggregation report (`ledger-queries.ts:4399-4433`) — a category with `form990Line = NULL` buckets under "Unmapped / <category name>"; a non-null value buckets by that string verbatim. There is no enum/lookup table backing it — it's free text with no format validation anywhere in the app, client or server.
- Audit trail: the only audit-log-shaped tables in the schema are `permissionAuditLog`, `googleGroupSyncLog`, and `failedLoginAttempts` (`schema.ts` — grepped every `pgTable(...)` matching audit/log/history). **None of them cover ledger writes.** A rename/merge/deactivate leaves only a bare `updatedAt` timestamp with no record of which admin did it.
- `FEATURES.LEDGER_MANAGE` (`ledger.manage`) is bound to the `admin` role only, per `drizzle/migrations/0045_ledger_permissions.sql:66-69`. The settings page (`src/app/(dashboard)/admin/ledger/settings/page.tsx:14-17`) already gates on it and redirects to `/admin/ledger` otherwise — this is the correct, already-proven key. No new `FEATURES` entry needed.
- `POST /api/admin/ledger/categories` (`src/app/api/admin/ledger/categories/route.ts`) is the **only** existing write path for categories today — create only. There is no PATCH, DELETE, or merge route. Everything except "create" is entirely new API surface.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (Treasurer/Coordinator with `ledger.manage`) | View the list of ledger categories, grouped by entity (Club/Foundation) × fund kind × flow | On demand |
| Admin | Create a new category | Occasional (already shipped, inline in Budget Editor — this adds a second entry point) |
| Admin | Rename an existing category | Occasional (happened once this week) |
| Admin | Deactivate a category (soft-remove from future pickers) | Occasional (would have happened twice this week — Awards, Supplies — if merge weren't chosen instead) |
| Admin | Merge one category into another | Rare (happened twice this week, both zero-transaction sources) |
| Admin | Edit `countsAsGiving` / `form990Line` flags on a category | Rare |

## Flows

**Flow 1 — Rename a category:** Categories list on `/admin/ledger/settings` → click a category row → edit name inline or in a small dialog → system shows a count of transactions and budget rows (across *every* fiscal year, not just the open one) that will now display under the new name, flagging any that belong to a locked year → admin confirms via `<ConfirmDialog>` → name updates everywhere it's joined by id (transaction list, budget editor, reports, 990 aggregation).
- Failure: empty name → inline validation error, no request sent. Name collides case-insensitively with another active category in the same (entity, fundKind, flow) → 409, "A category named 'X' already exists for this fund." DB/network error → toast, "Couldn't rename category — try again," row reverts to prior name.

**Flow 2 — Deactivate a category:** Categories list → "Deactivate" action on a row → `<ConfirmDialog>` (destructive) showing whether the category has an unbudgeted-but-still-open FY budget row or recent transactions → confirm → `isActive` set `false`.
- Success: category disappears from every "add transaction" / "add budget line" picker going forward. Historical transactions and budget rows keep displaying its name and amount unchanged (they join by id, not filtered by `isActive`).
- Failure: DB/network error → toast, category stays active. (No lock-based failure case identified — deactivating doesn't touch `ledger_budgets` rows, so `assertBudgetUnlocked` arguably doesn't apply; see Open Questions.)
- Gap: there is no "Reactivate" step described anywhere in the request or the evidence. Once the only code path that can set `isActive=false` exists, something must also be able to undo it, or a treasurer typo becomes permanent.

**Flow 3 — Create a category (new entry point only):** Categories list → "+ New category" → same fields as the existing Budget Editor inline flow (entity, fund kind, flow, name, `countsAsGiving`, `form990Line`) → same `POST /api/admin/ledger/categories`, same validation, same 409-on-duplicate.
- Failure path already shipped and covered by the existing endpoint's error handling — no new failure surface here beyond "this is now reachable from a second page."

**Flow 4 — Merge two categories:** Categories list → "Merge into..." on a source category → pick a destination category (same entity/fundKind/flow) → system checks the source has **zero** `ledger_transactions` rows referencing it → for every fiscal year where *both* source and destination have a budget row, refuse ("resolve by hand" — matching the script's own message) → otherwise show a per-year plan (amounts moving, new destination totals) → confirm via `<ConfirmDialog>` → re-point each year's `ledger_budgets.category_id` to the destination; source category is **not** deleted, just left with no budget rows (matches script precedent — FY2025's `Awards`/`Supplies` rows were deliberately preserved, not rewritten).
- Failure: source category has any transaction ever posted to it → blocked outright, "This category has N transactions — merging categories with transaction history isn't supported yet." Destination already has a budget row for a year the source also has one → blocked, "resolve by hand," listing the conflicting year(s). Current fiscal year locked → blocked (matches both scripts' guard).
- This is a **narrower** merge than the word implies — see Gaps below.

**Flow 5 — Edit `countsAsGiving` / `form990Line`:** Categories list → edit icon on a row → toggle `countsAsGiving` or change `form990Line` text → if the category has any transactions, show the dollar total and transaction count currently counted toward (or excluded from) reported giving → confirm → save.
- Failure: DB/network error → toast, value reverts. No format validation exists today for `form990Line` — see Gaps.

## Permissions

- **Permission(s):** Existing `FEATURES.LEDGER_MANAGE` (`ledger.manage`) covers every flow above — same key already gating `/admin/ledger/settings` and the existing category-create endpoint. No new key.
- **Default roles:** Admin only (per `0045_ledger_permissions.sql`), unchanged.

## Gaps the Request Didn't Address

- **Rename across fiscal years with mixed lock status is undefined.** A category's name lives on `ledgerCategories`, not copied per fiscal year, so renaming rewrites *every* year's display — including locked, board-approved years. The one real precedent (Bags to Benches) deliberately let a locked/closed FY2025 line relabel, but only checked FY2026's lock before writing. The new UI needs one explicit, stated rule (not silently inherited from a script written for a single known-safe case) — see Open Questions.
- **"Merge" in the request implies more than the scripts ever did.** Both real merges had zero-transaction sources; the script never re-points `ledger_transactions.category_id`, only `ledger_budgets`. A general merge UI that lets an admin pick two categories where the *source has real transaction history* would need new logic with no precedent and real risk (bulk `UPDATE ledger_transactions SET category_id = ...` across possibly thousands of rows, then re-checking every affected report). Recommend the v1 "merge" match the script's actual scope — refuse whenever the source has any transactions — and treat true transaction-repointing merge as a separate, later feature if it's ever needed.
- **No audit trail.** `ledgerCategories` has `updatedAt` but no actor column, and there is no ledger-specific audit-log table (only `permissionAuditLog`, `googleGroupSyncLog`, `failedLoginAttempts` exist, none of which cover this). Renaming, deactivating, or merging a live-books category leaves no record of who did it. This is a bigger deal than most admin edits because it's destructive against financial history that may end up in front of the board or IRS Form 990. Flag for tech-lead: either a lightweight `ledger_category_audit_log` table (mirroring `permissionAuditLog`'s shape) or an explicit "no audit trail" decision logged in `docs/decisions.md`.
- **`countsAsGiving` flips are retroactive and currently silent.** Per `DECISION-030`, this flag is what excludes operational/fundraising-overhead spend from `/members/impact`. Flipping it on a category with existing transactions instantly changes what the public-facing giving totals show for every past transaction on that category — with no warning today (this is new UI, so "today" means "if built naively"). Needs an explicit affected-dollar-amount confirmation, not just a toggle.
- **`form990Line` has no format validation anywhere** — free text, no enum, no lookup table. A typo here doesn't error, it silently mis-files that category's spend into an "Unmapped / <name>" bucket or a bogus custom line label in the 990 aggregation report the treasurer relies on for compliance prep. At minimum this needs a length cap and probably a picker constrained to line values already in use elsewhere in the system, not a bare text input.
- **No length limits on `name` or `form990Line`.** `ledgerCategories.name`/`form990Line` are unbounded `text` columns, and `validateCategoryCreateInput` doesn't cap length either — unlike every other Ledger free-text field in this codebase, which the scripts themselves show is app-enforced (`NOTE_MAX = 500`, `LABEL_MAX = 120`). This feature should adopt the same pattern (e.g., a ~100-char name cap) rather than being the one place in Ledger with no cap.
- **No DB-level uniqueness on the category natural key** `(entityId, fundKind, flow, name)` — it's enforced only in application code at create time (`validateCategoryCreateInput`, case-insensitive). A rename or merge-destination-rename path must reimplement that same check by hand; nothing in the database backs it up if a future code path forgets to.
- **Reactivation is unaddressed.** The request only asks to "manage categories," and evidence only shows removal-shaped operations (merge, and Awards/Supplies could plausibly have been deactivated instead). But once this UI can set `isActive=false` for the first time in the app's history, it needs a symmetric way to undo it, or a mistaken deactivation is permanent without a support-engineer's SQL intervention.
- **Empty/long-list state unaddressed.** A category list is naturally sliced by entity (Club/Foundation) × fund kind (up to 4) × flow (2) — the request doesn't say whether this renders as one long table, grouped accordion, or per-fund tabs, and doesn't address what a brand-new entity with zero categories shows.
- **Locked-budget interaction for deactivate is unclear.** Deactivating a category doesn't write to `ledger_budgets` at all, so it's not obviously covered by `assertBudgetUnlocked` — but a treasurer could deactivate a category that still has a real, unbudgeted, non-zero balance sitting in the *open* fiscal year, silently hiding it from future entry while leaving it live. Worth an explicit warning (not necessarily a hard block) when the category has any non-locked-year budget row.
- **Google Group sync, email queue, OAuth-vs-password paths:** not applicable — this feature is entity/category metadata only, touches no member, group, or auth records. Confirmed not silently skipped.
- **Brand consistency:** confirm the Categories list uses `rounded-2xl` cards (matching the rest of `/admin/ledger`), `rounded-lg` buttons, and `<ConfirmDialog>` (never `window.confirm`) for deactivate, rename-with-history, merge, and any retroactive `countsAsGiving` flip — all of these are exactly the class of destructive-on-live-data action the project's `<ConfirmDialog>` convention exists for.
- **Mobile (360px):** admin-only surface, but still in scope per CLAUDE.md's UX guidelines — a wide table (name, fund, flow, `countsAsGiving`, `form990Line`, actions) will need a responsive treatment, not just horizontal scroll-and-hope.

## Out of Scope (confirm with user)

- **General merge with transaction re-pointing** (source category has real transaction history) — no precedent, materially riskier, recommend a follow-up feature if it's ever actually needed rather than building it speculatively now.
- **Hard delete** of a category — the `ON DELETE SET NULL` FK behavior on both `ledger_transactions.category_id` and `ledger_budgets.category_id` makes this silently destructive; `isActive=false` is the only safe "remove," and true delete should not be exposed in this UI at all.
- **Bulk operations** (rename/deactivate/merge many categories at once) — nothing in the two-day evidence suggests this is needed; each real operation was one category at a time, hand-verified.
- **Manual `sortOrder` reordering** from Settings — today `sortOrder` is only ever auto-appended on create (`nextCategorySortOrder`); the request doesn't ask for drag-to-reorder and it adds real scope.
- **Cross-entity moves** (a category migrating from Club to Foundation, or between fund kinds) — no evidence this is a real need; the natural key includes `entityId`/`fundKind`, so this would effectively be a different feature (closer to merge-across-scope) than "manage categories."

## Open Questions

- **Rename + fiscal-year locks:** should renaming a category be allowed to relabel a locked/approved prior year's budget line (as happened with Bags to Benches), blocked outright if *any* fiscal year referencing this category is locked, or allowed with a mandatory warning that lists which locked years will be affected? The two existing scripts don't agree with each other on how far the lock check should reach — this needs one explicit rule from the treasurer, not an inherited assumption.
- **Merge scope for v1:** is it acceptable to ship merge restricted to "source category has zero transactions" (exactly what happened twice this week), refusing otherwise with a clear message — or does the treasurer already have a merge in mind where the source *does* have history, which would need the larger, riskier transaction-repointing feature?
- **Reactivation:** should deactivated categories stay visible (grayed out, with a "Reactivate" action) on the same Categories screen, or disappear from the admin UI entirely once deactivated (making it effectively one-way without a script)?
- **Audit trail:** is "no record of who renamed/deactivated/merged what, beyond a bare `updatedAt` timestamp" acceptable for destructive edits to live financial books — or does this feature need to add actor tracking (new table, or extending the `permissionAuditLog` pattern)?
- **`countsAsGiving` confirmation bar:** given it retroactively changes the club's publicly reported giving totals, is a standard `<ConfirmDialog>` sufficient, or does the treasurer want something stronger (e.g., must type the category name, or must show board-facing dollar impact) before a flip takes effect?
- **`form990Line` validation:** should this field be constrained to a fixed list of valid 990 line codes (does one exist anywhere — IRS instructions, a prior filing, `docs/`?), or does free text stay, just with a length cap and maybe an autocomplete against values already in use?
- **Category name length cap:** what's the treasurer's preferred limit? Existing Ledger free-text fields cap at 500 (notes) or 120 (cause labels) — a category name is closer to the 120-char cause-label case.
- **Deactivate-with-open-balance warning:** should deactivating a category that still has a non-zero, non-locked-year budget row be a hard block, a warning-then-allow, or unrestricted?

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved.**

The shape is sound: existing permission key, existing route-group, existing UI primitives, existing
FK/lock discipline. This review rules on the seven structural questions the analyst and the requester
left open, so Phase 3 has one authoritative source instead of re-deriving placement from precedent
each time.

## Rulings on the seven structural questions

### 1. Audit trail — one new table, `ledgerAuditLog`; generalize the SCHEMA now, not the code

New dedicated table, not an extension of `permissionAuditLog`/`googleGroupSyncLog`/`failedLoginAttempts`
(none are ledger-shaped — `permissionAuditLog` is specifically about role/feature grants) and not a
generic cross-app audit table (this project has no precedent for one shared audit table across
unrelated domains; `permissionAuditLog` itself is domain-scoped, not general-purpose).

Mirror `permissionAuditLog`'s existing shape — **typed nullable FK columns per target kind**, not a
polymorphic `(targetType text, targetId uuid)` pair. That's the established convention in this
codebase (`targetUserId` / `targetRoleId` / `targetFeatureId`) and it keeps real referential integrity
(`ON DELETE SET NULL`) instead of an unenforced string+uuid pair. Columns:

```
ledger_audit_log
  id                  uuid pk default random
  actor_user_id       uuid references users(id) on delete set null
  action              text not null   -- 'category_created' | 'category_renamed' |
                                       -- 'category_merged' | 'category_deactivated' |
                                       -- 'category_reactivated' | 'category_flags_updated'
  target_category_id  uuid references ledger_categories(id) on delete set null
  before              text            -- JSON snapshot of the changed field(s)
  after               text            -- JSON snapshot of the changed field(s)
  details             text            -- human-readable note (affected FYs, merge partner, $ impact)
  created_at          timestamp not null default now()
index ix_ledger_audit_log_category on (target_category_id)
index ix_ledger_audit_log_created on (created_at)
```

**Design for the stated future need (transaction/budget audit) at the schema level, not the code
level.** The treasurer's own note flags that transaction edits and budget changes will plausibly want
the same audit later. Naming the table `ledger_audit_log` (not `ledger_category_audit_log`) and giving
`action` a free-text convention (matching `permissionAuditLog.action`'s existing style, no CHECK
constraint — this codebase doesn't use enum/CHECK constraints for these classifier columns anywhere,
e.g. `fundKind`/`flow` on `ledgerCategories` itself) means a future increment adds `target_transaction_id`
/ `target_budget_id` columns to the *same* table via an additive, idempotent `ALTER TABLE ... ADD COLUMN
IF NOT EXISTS` migration — no rename, no data migration, no second table to reconcile against this one
in reports. That's the cheap, low-regret part of "designing for it now."

Do **not** generalize the *code* yet — no speculative `src/lib/ledger-audit.ts` shared helper with a
single caller. Per DECISION-061's own precedent ("favor catching a real gap... over inventing a
parallel structure ahead of a second consumer"), the audit-write helper lives as a small function
inside `ledger-category-queries.ts` (see #2) with exactly the shape category-management needs. When a
transaction/budget-audit feature is actually built, extracting a shared `logLedgerAudit()` at that
point is a mechanical, low-risk refactor — the schema is already ready for it; the code doesn't need to
pre-pay for a caller that doesn't exist yet.

**Impact:** New `schema.ts` entry (placed in the Ledger section, immediately after `ledgerCategories`,
not in the general-tables area near `permissionAuditLog`), and a matching idempotent migration —
suggest `drizzle/migrations/0074_ledger_category_audit.sql` (next unused number; `CREATE TABLE IF NOT
EXISTS`, guarded index creation).

### 2. Where the code lives

- **New sibling module `src/lib/ledger-category-queries.ts`.** `ledger-queries.ts` is 5,149 lines —
  well past the size where DECISION-049/DECISION-061 already established the split precedent
  (`reconciliation-queries.ts`, `financial-report-queries.ts`, `ledger-search-queries.ts`). Category
  management is exactly the shape those decisions describe: "a distinct cross-cutting surface composing
  the existing engine, not a rework of it." This new module owns `renameCategory()`,
  `updateCategoryFlags()`, `setCategoryActive()`, `mergeCategories()`, `getCategoryImpact()`, and the
  audit-write helper — all mutations plus the one new read (impact preview). It imports
  `getCategories()`, `getEntityById()`, `getFunds()`, `assertBudgetUnlocked()` from `ledger-queries.ts`
  the same way the existing `POST /api/admin/ledger/categories` route already does — read surface stays
  put, only the new write/impact surface moves out.
- **API routes — extend `categories/route.ts`, add three new files, no bare PATCH/DELETE on the
  existing route.** Follow the `transactions/[id]/{approve,reject,split}` convention already
  established in this exact directory tree, adapted to the fact that categories have no complex state
  machine (no `reconciledSessionId`/`transferGroupId`-style guard chains to justify one-action-per-route):
  - `GET /api/admin/ledger/categories/route.ts` — **new**, list with `entityId`/`fundKind`/`flow`/
    `includeInactive` query params. (Existing `POST` is unchanged.)
  - `PATCH /api/admin/ledger/categories/[id]/route.ts` — **new**. Handles rename, `countsAsGiving`,
    `form990Line`, **and `isActive`** as one general-purpose "edit this category" endpoint — deliberately
    *not* a one-way `POST .../deactivate` action route. Categories don't have the irreversible,
    multi-guard state transitions that justify `approve`/`reject`/`split` being separate routes; treating
    `isActive` as just another PATCH-able field means reactivation (`isActive: true`) costs nothing extra
    at the API layer and closes Phase 1's flagged "no way to undo a deactivation" gap for free, regardless
    of what Phase 3/UI decides to expose in v1. Writes one `ledgerAuditLog` row per call, `action` set
    per which field(s) actually changed.
  - `GET /api/admin/ledger/categories/[id]/impact/route.ts` — **new**, read-only. Returns transaction
    count, budget-line count, the list of fiscal years referencing the category (flagging which are
    locked), and current-FY open-balance info. Serves both the rename dialog's "what this affects"
    display and the deactivate confirm's open-balance warning — one query, two callers, per Treasurer
    Decision 1's requirement that rename show this before confirming.
  - `POST /api/admin/ledger/categories/merge/route.ts` — **new**, not nested under `[id]` since merge is
    inherently a two-category operation (mirrors `budgets/cause-lines/collapse` and
    `budgets/cause-lines/group` already being top-level action routes rather than nested under one id's
    subpath). Body `{ sourceId, destinationId, confirm?: boolean }`. **`confirm` false/omitted returns the
    plan without writing; `confirm: true` executes.** This is not a new idiom — it's the exact dry-run/
    `--apply` discipline `merge-club-budget-categories.ts` already uses, promoted from a CLI flag to a
    request body flag. Reuse that shape rather than inventing a separate preview endpoint.

### 3. Where it appears in the UI

New route `src/app/(dashboard)/admin/ledger/settings/categories/page.tsx` — a **sub-route of settings**,
not a section appended to `settings/page.tsx` and not a tab. `settings/page.tsx` is laid out
`max-w-2xl` for a short threshold/toggle form; a category list with real dimensionality (2 entities × up
to 4 fund kinds × 2 flows, 100+ rows) needs its own width and its own table/accordion, the same reason
`budgeting/[fundSlug]` is a distinct route from `budgeting` rather than a tab on it. `settings/page.tsx`
gets one small addition: a nav card linking to `settings/categories` (mirrors how other admin surfaces
cross-link sub-areas). Server Component page, `getCategories()`-family query extended to optionally
include inactive rows, grouped server-side by entity → fund kind → flow before render.

New client components under `src/components/admin/ledger/`: a category table/accordion component
owning selection + dialog-open state, a rename dialog, a merge dialog (destination picker via the
existing `Select` primitive), and an edit-flags dialog (or folded into rename — Phase 3's call). Exact
decomposition is a Phase 3/ux-developer decision; the constraint from here is: `'use client'` only on
these interactive pieces, the list page itself stays a Server Component, and every destructive/retroactive
action (deactivate, merge, `countsAsGiving` flip) goes through `<ConfirmDialog>` — never a native dialog.

### 4. Server/client split for the on-demand previews

**Route handler, not a server action, not preloaded.** This surface is 100% route-handler-driven
already (every other Ledger write in this app is `/api/admin/ledger/**`, not `'use server'` actions —
no exceptions found in the directory listing), so category management follows the same convention for
consistency, not because server actions are wrong in general.

Impact preview and merge plan are both **fetched on demand from a client component**, using the same
established pattern already in this tree (`reconciliation-match-picker.tsx`,
`split-transaction-dialog.tsx`, `fund-manage-dialog.tsx` — all client components that `fetch()` against
a route handler in response to a user selection, then call `router.refresh()` after a successful
mutation to re-pull the Server Component's data). No bespoke state-management or SWR/React-Query needed
— `router.refresh()` is this codebase's only post-mutation refresh idiom (34 files under
`src/components/admin/ledger/` already use `useRouter`), and there's no reason to introduce a second
one here.

### 5. Transactional integrity

`mergeCategories()` in `ledger-category-queries.ts` runs as **one Drizzle transaction**, matching the
scripts' hard-fail-and-roll-back discipline exactly:

1. Check current-FY lock via `assertBudgetUnlocked` (matches both scripts — they only ever checked the
   *current* fiscal year's lock, never every year the category has ever touched; Treasurer Decision 1's
   "rename may touch locked years" ruling doesn't extend to merge, which is a structural re-point, not a
   label change — merge stays exactly as narrow as the scripts that are its spec).
2. Assert the source category has zero `ledger_transactions` rows (refuse with count, per Treasurer
   Decision 2).
3. For every fiscal year where **both** source and destination have a `ledger_budgets` row, refuse
   outright and name the conflicting year(s) — this is the exact `(fund_id, fiscal_year, category_id,
   flow)` unique-constraint collision `merge-club-budget-categories.ts` already guards against
   (`"Both ... have FYNNNN budget rows ... resolve by hand"`). This check belongs in
   `ledger-category-queries.ts`, computed before any write, same as the scripts compute their `plan[]`
   before opening the transaction.
4. Inside the transaction: re-point each non-conflicting year's `ledger_budgets.category_id`, write the
   `ledgerAuditLog` row, and re-verify the affected fund's expense/income total lands where expected
   (the scripts' own belt-and-suspenders `EXPECTED_*_CENTS` assertion) — no, this last assertion is
   script-specific (it exists there because the script also rewrites Notes & Assumptions prose that has
   to stay truthful); the UI path doesn't rewrite prose, so it doesn't need a hardcoded expected-total
   assertion, only the unique-constraint pre-check. Any failure at any step rolls back the whole
   transaction, mirroring the scripts' `sql.begin(...)` behavior.

The `confirm: false` (plan) path in #2 above runs the same checks read-only, so the plan the treasurer
sees and the transaction that executes can never diverge — one code path, not two.

### 6. Dependencies

**None.** Everything here — transactions (`db.transaction()`, already used throughout `ledger-queries.ts`),
confirm dialogs, selects, tables — is already available. No new npm package needed; confirmed against
all five dependency-evaluation criteria (nothing here isn't already solved by `drizzle-orm` + existing UI
primitives).

### 7. Invariants

- **Schema is the source of truth:** `ledgerAuditLog` added to `schema.ts` first, migration second,
  matching every existing table in this codebase.
- **Migrations re-run on every deploy:** the `0074_ledger_category_audit.sql` migration must be
  `CREATE TABLE IF NOT EXISTS` + guarded `CREATE INDEX IF NOT EXISTS` (or a `DO $$ ... END $$` block) —
  no bare `CREATE INDEX`.
- **Permissions are the only gate:** every new/changed route (`GET`/`PATCH categories/[id]`,
  `GET .../impact`, `POST .../merge`) checks `auth()` + `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)`
  exactly like the existing `POST /categories` handler — no new `FEATURES` key, per Treasurer Decision 5.
- **Server/client boundary:** the categories list page is a Server Component by default; `'use client'`
  is confined to the table's interactive rows and the three dialogs.
- **No native browser dialogs:** deactivate, merge-confirm, and the `countsAsGiving` retroactive flip
  all use `<ConfirmDialog>` (destructive on the first two; the `countsAsGiving` flip should also be
  `destructive` styling given it retroactively changes publicly reported giving totals, even though it
  isn't literally irreversible). Rename with locked-year impact uses `<ConfirmDialog>` when the impact
  preview shows any locked year affected; a plain save is fine when it doesn't.
- **Brand consistency:** `rounded-2xl` for the category list card/table container and any preview panel,
  `rounded-lg` buttons, no `lions-red`.

## Notes for Phase 3 (tech-lead)

- Reactivation is technically free (ruling #2) but Phase 1's "Settled" list only names `create, rename,
  deactivate, edit flags, merge" — it does not list reactivate. Tech-lead should get an explicit
  treasurer sign-off on whether a "Reactivate" affordance ships in v1's UI, or whether `isActive: true`
  stays reachable-but-unexposed (API supports it either way; this is a UI-surface decision, not an
  architectural one).
- `form990Line` validation (length cap, possible autocomplete against in-use values) and the category
  `name` length cap are still open per Phase 1 — pick a number (Phase 1 suggested ~120, matching the
  cause-label cap) and enforce it in both the create path (`validateCategoryCreateInput`) and the new
  rename path, in one shared validator so they can't drift.
- The `countsAsGiving` flip's "dollar impact" figure and the deactivate "open balance" warning can both
  be served by the same `GET .../impact` endpoint (extend its response shape rather than adding a third
  read endpoint) — keep to one impact query per category, not one per action.
- Merge's `confirm: false` plan response and Treasurer Decision 2's refusal message ("this category has N
  transactions...") should share exact wording with the impact endpoint's transaction count so the UI
  never shows two different numbers for the same fact.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We're moving ledger-category maintenance (rename, deactivate/reactivate, edit `countsAsGiving`/`form990Line`, and a narrow zero-transaction merge) out of one-off `tsx` scripts and into `/admin/ledger/settings/categories`, gated by the existing `LEDGER_MANAGE` permission. The two scripts that ran this week (`apply-fy2026-budget-review.ts`'s rename, `merge-club-budget-categories.ts`'s merge) are the de-facto spec: same lock discipline, same refusal conditions, same "never touch `ledger_transactions`" boundary for merge. This design adds one new table (`ledgerAuditLog`, per DECISION-065) so these destructive edits to live financial books finally leave a record of who did what, and it makes rename/merge/deactivate's "what does this affect" preview a single reusable query instead of three different ones that could drift.

## Permissions

- Permission key: **`ledger.manage`** (`FEATURES.LEDGER_MANAGE`) — already exists, already Admin-bound (`drizzle/migrations/0045_ledger_permissions.sql`). No new key, no new migration for permissions (Treasurer Decision 5).
- Every new/changed route checks `auth()` then `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)`, in that order, exactly like `categories/route.ts`'s existing `POST` handler.

## Data Model

### New table: `ledgerAuditLog` (`ledger_audit_log`)

Placed in `src/lib/db/schema.ts` in the Ledger section, immediately after `ledgerCategories` (per architect Ruling #1). Mirrors `permissionAuditLog`'s typed-FK-per-target-kind shape (`schema.ts:107-116`), not a polymorphic `(targetType, targetId)` pair:

```typescript
export const ledgerAuditLog = pgTable(
  "ledger_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    // 'category_renamed' | 'category_merged' | 'category_deactivated' |
    // 'category_reactivated' | 'category_flags_updated'
    // ('category_created' is a reserved future value — see Edge Cases: create is NOT audited in v1.)
    action: text("action").notNull(),
    targetCategoryId: uuid("target_category_id").references(() => ledgerCategories.id, { onDelete: "set null" }),
    // JSON-stringified subset of {name, countsAsGiving, form990Line, isActive} that
    // changed. Null for 'category_merged' — merge is a structural two-category
    // re-point, not a single-row field flip; its full description lives in `details`.
    before: text("before"),
    after: text("after"),
    // Human-readable note: affected fiscal years, merge partner name/id, $ impact.
    details: text("details"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ix_ledger_audit_log_category").on(t.targetCategoryId),
    index("ix_ledger_audit_log_created").on(t.createdAt),
  ],
);

export type LedgerAuditLog = typeof ledgerAuditLog.$inferSelect;
export type NewLedgerAuditLog = typeof ledgerAuditLog.$inferInsert;
```

**"What changed" shape:** `before`/`after` are JSON-stringified objects containing **only the fields that changed** in that call (e.g. a rename-only PATCH writes `before: {"name":"Program supplies"}`, `after: {"name":"Bags to Benches"}`; a PATCH that changes both `name` and `isActive` in one call writes both keys in each object). This is a snapshot-of-the-diff, not a full-row snapshot — matches `permissionAuditLog.details`'s existing "JSON details" convention in spirit, but as two typed columns instead of one, since before/after is the shape every reviewer will actually want when looking at a rename or a flag flip.

**Migration `drizzle/migrations/0074_ledger_category_audit.sql`** (next unused number — `0073` is the last one on disk):

```sql
-- Ledger Category Management: audit trail for category writes
-- (docs/work-log/2026-08-07-ledger-category-management.md, DECISION-065).
-- Table is named ledger_audit_log (not ledger_category_audit_log) and
-- target_category_id is one of several typed target-FK columns this table is
-- expected to grow (target_transaction_id, target_budget_id — additive,
-- future, out of scope here) — mirrors permission_audit_log's shape.

CREATE TABLE IF NOT EXISTS ledger_audit_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  action              TEXT NOT NULL,
  target_category_id  UUID REFERENCES ledger_categories(id) ON DELETE SET NULL,
  before              TEXT,
  after               TEXT,
  details             TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_audit_log_category'
  ) THEN
    CREATE INDEX ix_ledger_audit_log_category ON ledger_audit_log (target_category_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_audit_log_created'
  ) THEN
    CREATE INDEX ix_ledger_audit_log_created ON ledger_audit_log (created_at);
  END IF;
END $$;
```

Both the `CREATE TABLE` and the guarded index creation are safe to replay on every deploy.

### No other schema changes.

`ledgerCategories`, `ledgerTransactions`, `ledgerBudgets`, `ledgerBudgetApprovals` are unmodified. No new column, no new unique constraint (the `(entityId, fundKind, flow, name)` natural key stays app-layer-only — see DECISION-041 precedent, reaffirmed below under "Unresolved caps").

## The Impact Endpoint Contract

`GET /api/admin/ledger/categories/[id]/impact` is **one query, three callers**: the rename dialog's "what this affects" preview, the `countsAsGiving` flip's dollar-impact display, and the deactivate confirm's open-balance warning. One response shape, computed unconditionally (not conditioned on which action the caller is about to take), backed by a single `getCategoryImpact(categoryId)` function in `ledger-category-queries.ts`:

```typescript
type CategoryImpact = {
  category: {
    id: string; name: string; entityId: string;
    fundKind: string; flow: "income" | "expense";
    isActive: boolean; countsAsGiving: boolean; form990Line: string | null;
  };
  transactions: {
    /** COUNT(*) of ledger_transactions rows with category_id = this id,
     *  ANY status (posted, pending, rejected) — the same figure merge's
     *  refusal message uses, so the UI never shows two different numbers
     *  for "how many transactions reference this category." */
    total: number;
    /** SUM(amount_cents) WHERE status='posted' AND transfer_group_id IS NULL
     *  AND flow='expense' AND fund.kind IN ('activity','charitable','scholarship')
     *  for THIS category's own transactions — the exact filter getPhilanthropy()
     *  uses (ledger-queries.ts:4705-4712) minus the countsAsGiving condition
     *  (computed regardless of the category's CURRENT countsAsGiving value, so
     *  the UI can show "this is what would move" both before and after a flip).
     *  0 for income-flow or administrative-fund categories, where it's not
     *  applicable — /members/impact never counts those rows regardless. */
    postedGivingCents: number;
  };
  budgetLines: {
    /** COUNT of ledger_budgets rows referencing this category, ALL fiscal years. */
    total: number;
    fiscalYears: Array<{
      fiscalYear: number;
      entityName: string;
      fundName: string;
      flow: "income" | "expense";
      annualAmountCents: number;
      /** From ledger_budget_approvals for (entityId, fiscalYear). */
      locked: boolean;
    }>;
  };
  openBalance: {
    currentFiscalYear: number;
    /** True if a ledger_budgets row exists for (this category, currentFiscalYear)
     *  and that year is not locked. Informational only — see Edge Cases. */
    hasNonLockedBudgetRow: boolean;
    currentFyBudgetedCents: number | null;
  };
};
```

- **Rename impact** = `transactions.total` + `budgetLines.fiscalYears` (client highlights any `locked: true` entries — Treasurer Decision 1 already allows relabeling them, this is disclosure, not a block).
- **`countsAsGiving` dollar impact** = `transactions.postedGivingCents`.
- **Deactivate open-balance warning** = `openBalance`.

## Full API Contracts

All four routes: `auth()` → 401 if no session; `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)` → 403 if false. All JSON in/out.

### `GET /api/admin/ledger/categories` (new)

Query params: `entityId` (required), `fundKind` (optional, one of the 4 valid kinds), `flow` (optional, `income`|`expense`), `includeInactive` (optional, `"true"`|omitted).

Response 200: `{ categories: LedgerCategoryDTO[] }`, DTO = full `LedgerCategory` row (id, name, fundKind, flow, sortOrder, isActive, countsAsGiving, form990Line, createdAt, updatedAt), ordered `sortOrder, name` (matches `getCategories`).

Errors: 400 missing/invalid `entityId`/`fundKind`/`flow`; 401; 403; 404 entity not found.

### `PATCH /api/admin/ledger/categories/[id]` (new)

Body — any non-empty subset of:
```
{ name?: string; countsAsGiving?: boolean; form990Line?: string | null; isActive?: boolean }
```

Validation, in order:
1. 404 if category doesn't exist.
2. If `name` present: run `validateCategoryEditInput` (new — see "Unresolved caps" below): trim, reject empty (400), reject `length > MAX_CATEGORY_NAME_LENGTH` (400), case-insensitive collision check scoped to `(entityId, fundKind, flow)` **excluding this category's own id** (409, same message shape as create: `A category named 'X' already exists for this fund.`). **No lock check** — Treasurer Decision 1 explicitly allows renaming a category a locked year references.
3. If `form990Line` present: `null` or `""` (after trim) stores `NULL`; otherwise trim and reject `length > MAX_FORM_990_LINE_LENGTH` (400).
4. If `countsAsGiving` present: must be boolean (400 otherwise).
5. If `isActive` present: must be boolean (400 otherwise). No block either direction — deactivate (`true→false`) and reactivate (`false→true`) are both unconditional at the API layer (open-balance is a warning surfaced by the impact endpoint before the call, never a server-side block — see Edge Cases).
6. If no recognized field is present in the body: 400 `"No fields to update."`

On success: one `UPDATE ledger_categories` with only the changed columns + `updatedAt`, then one `ledgerAuditLog` insert (same transaction). Action precedence when multiple fields change in one call (name always wins visibility, since a rename is the most reader-relevant fact):
   - `name` changed → `action = "category_renamed"`
   - else `isActive` changed `false → true` → `"category_reactivated"`
   - else `isActive` changed `true → false` → `"category_deactivated"`
   - else (only `countsAsGiving`/`form990Line` changed) → `"category_flags_updated"`
   
   `before`/`after` always capture **every** changed field regardless of which action name won, so nothing is lost even when a rename and a flag change ride in the same request.

Response 200: updated `LedgerCategoryDTO`.

Errors: 400 (validation per above, or empty body); 401; 403; 404; 409 (name collision).

### `GET /api/admin/ledger/categories/[id]/impact` (new)

No body. Response 200: `CategoryImpact` (shape above). Errors: 401; 403; 404 category not found.

### `POST /api/admin/ledger/categories/merge` (new, top-level — not nested under `[id]`)

Body: `{ sourceId: string; destinationId: string; confirm?: boolean }`

Validation / refusal order (identical for `confirm: false` "plan" and `confirm: true` "apply" — one code path, per architect Ruling #5):
1. 400 if `sourceId`/`destinationId` missing or `sourceId === destinationId`.
2. 404 if either category doesn't exist.
3. 400 if source/destination don't share `(entityId, fundKind, flow)` — `"Source and destination must be the same entity, fund, and flow."` (implicit in both scripts' scoped queries; made explicit here since the UI could otherwise offer a cross-scope pick).
4. 409 if destination `isActive === false` — `"Cannot merge into 'X' — it is deactivated. Reactivate it first."` (edge case #2 below; source may be active or inactive).
5. 409 if the **current fiscal year** is locked for the shared `entityId` (`assertBudgetUnlocked(entityId, currentFiscalYear(new Date()))`) — matches both scripts, which only ever checked the current year.
6. 409 if `sourceTransactionCount > 0` (via the same count `getCategoryImpact` uses) — `"This category has N transaction(s) — merging categories with transaction history isn't supported yet."`, N substituted (Treasurer Decision 2: state the reason AND the count).
7. 409 if any fiscal year has a `ledger_budgets` row on **both** source and destination — `"Both 'Awards' and 'Member recognition' have FY2026 budget rows — resolve by hand."`, naming every conflicting year (mirrors `merge-club-budget-categories.ts`'s exact message shape).

If all checks pass, compute the plan: every fiscal year where **source has a row and destination does not** gets re-pointed. Each planned year is annotated `locked: boolean` (informational — Treasurer Decision 1 / architect Ruling #5 only gate on the *current* year; a locked *prior* year with a source-only row is still re-pointed, exactly like the scripts, but the UI must show the treasurer which years are locked before they confirm).

`confirm` false or omitted → response 200:
```
{ plan: Array<{ fiscalYear: number; entityName: string; fundName: string; annualAmountCents: number; locked: boolean }>,
  sourceTransactionCount: 0,
  destinationName: string }
```
No writes.

`confirm: true` → executes in one Drizzle transaction: for each planned year, `UPDATE ledger_budgets SET category_id = destinationId, updated_at = now() WHERE id = ...`; write one `ledgerAuditLog` row (`action: "category_merged"`, `targetCategoryId: sourceId`, `before: null`, `after: null`, `details`: human text naming the destination and every affected fiscal year). Source category is **not** touched otherwise — not deactivated, not renamed (matches both scripts: FY2025's `Awards`/`Supplies` rows were deliberately left alone). Response 200:
```
{ merged: true, destinationId: string, affectedFiscalYears: number[] }
```

Errors: 400 (missing ids, same id, scope mismatch); 401; 403; 404 (either category); 409 (destination inactive / current-FY locked / source has transactions / both-sides budget-year collision).

## The Unresolved Caps

- **`MAX_CATEGORY_NAME_LENGTH = 120`** and **`MAX_FORM_990_LINE_LENGTH = 120`** — new consts in `src/lib/ledger.ts`, next to `MAX_BUDGET_LINE_LABEL_LENGTH` (also 120). 120 matches Phase 1's own recommendation (closer to the cause-label cap than the 500-char note cap — a category name is a short label, not prose) and gives both new free-text fields the same ceiling for one less number to remember.
- **Enforcement: app layer only, both create and rename**, per DECISION-041's established precedent (no DB `CHECK` — this codebase has none for `text` classifier/label columns). Concretely:
  - `validateCategoryCreateInput` (existing, `ledger.ts:1558`) gains a length check on `trimmedName` — a strictly additive change (adds one more rejection case; every currently-valid call site is unaffected since no existing category name is close to 120 chars).
  - New `validateCategoryEditInput` (new, `ledger.ts`) is the PATCH-side twin: same trimmed-length + case-insensitive-collision core, but scoped to `existingNames` that **exclude the category's own current name** (so renaming a category to its own unchanged name, or fixing casing only, isn't a false-positive collision). Factor the shared trim/length/collision logic into one small private helper both call, so the two validators can't drift on what "too long" or "a collision" means — the same DRY instinct this file already applies via `validateRequiredTrimmedText`.
  - `form990Line`: trimmed, empty → `null`, else length-capped. No enum, no autocomplete against in-use values in v1 — there's no canonical IRS-line list anywhere in this codebase or `docs/`, and Phase 1 only floated autocomplete as a "maybe." A length cap on free text is the whole of v1's validation here; a controlled list is a real follow-up if the treasurer produces one from an actual 990 filing, not a Phase 3 guess.

## UI Design

**New page:** `src/app/(dashboard)/admin/ledger/settings/categories/page.tsx` — Server Component, auth+`hasFeature` guard identical to `settings/page.tsx`'s (redirect to `/admin/ledger` if ungated). Fetches all categories for every entity via `getCategories`-family calls (extended to accept `includeInactive`), grouped server-side: **Entity (Club / Foundation) → Fund kind → Flow**, rendered as a nested accordion (entity tabs or top-level sections, fund-kind sub-headers, flow sub-groups within each) rather than one flat 100+ row table — same reasoning the architect gave for why this is its own route instead of a `settings/page.tsx` tab: real dimensionality needs real layout room. `settings/page.tsx` gains one small `rounded-2xl` nav card linking here (mirrors existing cross-links to other admin sub-areas).

**Filter/search bar** at the top of the page (client component): entity toggle, fund-kind filter, flow filter, a "Show inactive" checkbox (off by default — matches every existing picker's default), and a text search-as-you-type over category name (client-side filter over the already-fetched list; no new endpoint needed for 100-ish rows).

**Row actions**, gated to `LEDGER_MANAGE` (the whole page is already gated, so every action on it is too):
- Active row: Rename, Edit flags (`countsAsGiving`/`form990Line`), Merge into..., Deactivate.
- Inactive row: rendered visually muted (gray text/background, an "Inactive" badge) with only **Reactivate** and Rename available — merge/flag-edit stay reachable via Rename's dialog if truly needed, but the primary affordance on an inactive row is getting it back to active or fixing its name, not deep editing (per Coordinator decision: Reactivate ships in v1).

**Components** under `src/components/admin/ledger/` (exact file boundaries are ux-developer's call in Phase 4; this is the shape):
- `category-list.tsx` — client, owns the filter state + which dialog is open, renders the grouped table/accordion, calls `router.refresh()` after any successful mutation (established idiom, 34 existing call sites).
- `category-rename-dialog.tsx` — on open, `fetch`es `GET .../impact`, shows the transaction/budget-line counts and any locked fiscal years, name input with live `MAX_CATEGORY_NAME_LENGTH` counter. If the impact response shows **any** locked fiscal year, the Save button routes through `<ConfirmDialog>` (not `destructive` — a rename isn't reversal-costly the way deactivate/merge are, but it's still relabeling board-approved history and deserves an explicit "yes, relabel FY2025 too" click); otherwise a plain save.
- `category-flags-dialog.tsx` (or folded into rename — ux-developer's call, per architect note) — `countsAsGiving` toggle and `form990Line` text field. Toggling `countsAsGiving` off (or on, from off) triggers a `GET .../impact` fetch to show `postedGivingCents` before commit, behind `<ConfirmDialog destructive>` (retroactively changes public `/members/impact` totals — treasurer decision-worthy even though it's not literally irreversible, per architect Ruling #7).
- `category-merge-dialog.tsx` — destination picker via the existing `Select` primitive, **filtered client-side to active categories in the same (entityId, fundKind, flow)** as the source (destination-inactive is also enforced server-side, per Edge Cases below — belt and suspenders). On pick, fetches `POST .../merge` with `confirm: false` to render the plan (years, amounts, any locked-year flags) or the refusal message verbatim (409 body's `error` string — already phrased with the transaction count / conflicting years, so the dialog doesn't need to reconstruct wording). Confirm button goes through `<ConfirmDialog destructive>`, re-POSTs with `confirm: true`.
- Deactivate action: no separate dialog — a `<ConfirmDialog destructive>` directly on the row action, description populated from a `GET .../impact` fetch on click-to-open (`openBalance.hasNonLockedBudgetRow` renders as a warning line inside the dialog body, never a blocker).
- Reactivate action: `<ConfirmDialog>` **not destructive** (undoing a soft-remove, not creating risk) — `PATCH { isActive: true }`.
- "+ New category" entry point: same fields/validation as the existing inline Budget Editor flow, same `POST /categories`, unchanged.

**Brand:** `rounded-2xl` for the list container and every dialog panel, `rounded-lg` buttons, no `lions-red`, focus rings on every interactive element per the UX guidelines already in `CLAUDE.md`.

**Mobile (360px):** the accordion grouping (entity → fund kind → flow) is also the mobile answer — each level collapses, so the 360px view is a stack of expandable sections rather than a wide table needing horizontal scroll. Row actions collapse into a kebab/overflow menu below a breakpoint, matching other admin tables in this app that already do this (ux-developer to confirm the existing pattern/component, not invent a new one).

## Edge Cases & Risks

- **Rename to a name that already exists in the same (entity, fundKind, flow):** 409 from `validateCategoryEditInput`'s collision check, excluding the row's own id — this is the exact natural-key collision `merge-club-budget-categories.ts`'s header documents as the reason it moved budget rows instead of renaming.
- **Merging into an inactive destination:** blocked with a 409 naming the destination and telling the treasurer to reactivate it first (rather than silently reactivating it as a side effect of merge, which would be a surprising, unrequested state change).
- **Category with zero transactions but budget rows in a locked prior year (merge target):** allowed — Treasurer Decision 1 / architect Ruling #5 only gate merge on the *current* fiscal year's lock, matching both scripts exactly. The plan/impact response flags `locked: true` on that year so the treasurer sees it before confirming, but it is not a block. This is a deliberate, already-settled asymmetry versus rename (which shows locked years but never blocks) and deactivate (which never even looks at locks) — merge is the only operation that hard-blocks on a lock, and only the current year's.
- **Deactivating a category with an open, non-locked, non-zero current-FY budget row:** warning-then-allow, not a hard block (this was Phase 1's open question; architect left it to Phase 3). Rationale: deactivating only flips `isActive` — it never touches `ledger_budgets` — so there is no data-integrity reason to block it, only a "you might be hiding a live line" UX concern, which `openBalance.hasNonLockedBudgetRow` surfaces in the `<ConfirmDialog>` body. **Logged as an implementation decision in `docs/decisions.md`** (new entry, below) since Phase 1 explicitly flagged it as unresolved and the architect didn't rule on it.
- **Concurrent edits (two admins editing the same category near-simultaneously):** last-write-wins, no optimistic-concurrency column added. This matches every other Ledger write path in the app today (no version/`etag` column exists anywhere in `ledgerBudgets`/`ledgerBudgetLines`/`ledgerTransactions` either) — introducing one here for a low-traffic, small-admin-team surface would be scope the request never asked for. The new audit log at least means a stomped edit is now visible after the fact, which it wasn't before this feature existed.
- **Create is not audited in v1.** Treasurer Decision 3 lists renames, merges, deactivations, and flag changes — it does not list creation, and architect Ruling #3 leaves `POST /categories` completely unchanged. `ledgerAuditLog.action`'s doc comment reserves `'category_created'` as a value for a future increment that decides creation should be audited too, but this design does not add a write to that route. Flagging explicitly so Phase 4 doesn't "fix" this as an oversight.
- **Merge with `confirm: true` racing a lock being applied between the plan fetch and the apply POST:** the apply path re-runs every check (step 5 in the merge contract) inside its own request — a lock applied in between is caught on the apply call itself, not assumed from a stale plan. No time-of-check/time-of-use gap wider than a single request.

## Unit Tests for Phase 4

Implementer (database-admin for the pure-function tests, api-developer for the route-level ones) delivers these — not qa:

1. **`validateCategoryEditInput` rejects a name over `MAX_CATEGORY_NAME_LENGTH`** — 121-char name → `{ ok: false, status: 400 }`.
2. **`validateCategoryEditInput` allows renaming a category to its own current name** (case-only change included) — not treated as a collision against itself.
3. **`validateCategoryEditInput` rejects a case-insensitive collision against a sibling category, excluding self** — two categories `"Awards"`/`"awards "` (trimmed) in the same scope, edited-category's own name excluded from the collision set.
4. **`mergeCategories` refuses when the source has any transactions, and the message includes the exact count** — seed source category with N (e.g. 3) transactions of any status, assert the 409 body's `error` contains `"3 transaction"`.
5. **`mergeCategories` refuses when both source and destination have a budget row in the same fiscal year**, naming that year in the message — matches `merge-club-budget-categories.ts`'s own collision scenario.
6. **`mergeCategories` refuses when the destination is inactive**, and succeeds once it's reactivated (holding all else constant).
7. **`mergeCategories`'s `confirm: false` plan and `confirm: true` apply agree** — the set of `fiscalYears`/amounts in the plan response exactly matches what actually got re-pointed after apply, for a scenario with 2+ non-conflicting years.
8. **`getCategoryImpact` counts are correct across multiple fiscal years** — seed budget rows for a category in FY2024 (locked) and FY2026 (unlocked); assert `budgetLines.total === 2` and the correct `locked` flag per year.
9. **`getCategoryImpact.transactions.postedGivingCents` matches `getPhilanthropy`'s own filter** — seed a mix of posted/pending/rejected and giving-eligible/non-eligible-fund-kind transactions on one category; assert the impact figure equals the sum `getPhilanthropy` would attribute to that category, and is `0` for an income-flow or administrative-fund category regardless of transaction data.
10. **A `ledgerAuditLog` row is written for each operation type** — rename, merge, deactivate, reactivate, flags-update each produce exactly one row with the correct `action` value and `before`/`after` containing only the changed field(s) (assert the precedence rule from the API contract: a simultaneous name+isActive change writes `action: "category_renamed"` but both fields present in `before`/`after`).
11. **Permission gate** — every one of the four routes returns 401 with no session and 403 for a session lacking `LEDGER_MANAGE`, before touching the database.
12. **`PATCH .../[id]` with an empty body (no recognized fields) returns 400**, no audit row written.

## Implementation Order

1. **database-admin** — add `ledgerAuditLog` to `schema.ts` (after `ledgerCategories`), author `drizzle/migrations/0074_ledger_category_audit.sql` exactly as specified above, run it locally. Add `MAX_CATEGORY_NAME_LENGTH`/`MAX_FORM_990_LINE_LENGTH` to `ledger.ts`, extend `validateCategoryCreateInput` with the length check, and add the new `validateCategoryEditInput` (+ the small shared private helper it and `validateCategoryCreateInput` both call). Write unit tests 1–3 (pure, no DB).
   **Handoff to api-developer:** schema is live, validators exist and are tested, migration has been run against dev.
2. **api-developer** — create `src/lib/ledger-category-queries.ts` (per DECISION-065: `renameCategory`, `updateCategoryFlags`, `setCategoryActive` — or one general `updateCategory` covering all PATCH-able fields per the contract above — `mergeCategories`, `getCategoryImpact`, and the audit-write helper, all importing `getCategories`/`getEntityById`/`getFunds`/`assertBudgetUnlocked` from `ledger-queries.ts` unchanged). Build the four route files (`categories/route.ts` gains `GET`; new `categories/[id]/route.ts`, `categories/[id]/impact/route.ts`, `categories/merge/route.ts`) per the API contracts above. Write unit tests 4–12.
   **Handoff to ux-developer:** all four endpoints are live, tested, and typecheck/build clean; the exact request/response shapes above are the contract to build against.
3. **ux-developer** — `src/app/(dashboard)/admin/ledger/settings/categories/page.tsx`, the nav-card addition to `settings/page.tsx`, and the client components described under UI Design. Manual click-through of every flow (rename with/without locked years, deactivate with/without open balance, merge success/every refusal path, reactivate, flags edit with dollar-impact preview) before handing to qa.

Release notes are written after Phase 6's SHIP IT, per the standard pipeline — not part of this implementation order.

---

# Phase 4 — Implementation

## Phase 4 — Implementation (schema) — 2026-08-07

**Owner:** database-admin
**Status:** complete

### Summary

Added `ledgerAuditLog` to `schema.ts` exactly per the Phase 3 design and DECISION-065/066 —
mirrors `permissionAuditLog`'s typed-FK-per-target-kind shape, `targetCategoryId` only for now,
schema-ready for additive `targetTransactionId`/`targetBudgetId` columns later. Wrote the
idempotent migration (`0074`, confirmed the next free number), applied it to the dev DB twice to
prove the second run is a clean no-op, and added `MAX_CATEGORY_NAME_LENGTH` /
`MAX_FORM_990_LINE_LENGTH` plus a `validateCategoryEditInput` validator (sharing a new private
trim/length/collision core with the existing `validateCategoryCreateInput`, which now also
enforces the 120-char cap) to `ledger.ts`. Stayed strictly in the schema/validator lane — did not
touch `ledger-queries.ts`, routes, or components.

### What I did

- Read the Phase 1 analyst review, Phase 2 architect verdict, Phase 3 design doc, and
  DECISION-065/066 in full before touching any file.
- Confirmed `0074` was the next free migration number (`ls drizzle/migrations/*.sql | sort |
  tail`; last on disk was `0073_members_membership_type.sql`).
- **`src/lib/db/schema.ts`:** added `ledgerAuditLog` immediately after `ledgerCategories`
  (per architect Ruling #1) — `id`, `actorUserId` (FK → `users.id`, `ON DELETE SET NULL`),
  `action` (free text, no CHECK, matching `fundKind`/`flow`'s existing convention on
  `ledgerCategories` itself), `targetCategoryId` (FK → `ledgerCategories.id`, `ON DELETE SET
  NULL`), `before`/`after` (nullable text), `details` (nullable text), `createdAt`. Two indexes:
  `ix_ledger_audit_log_category` on `targetCategoryId`, `ix_ledger_audit_log_created` on
  `createdAt`. Added a comment block explaining the `before`/`after` shape choice explicitly —
  JSON-stringified diffs of ONLY the changed fields (e.g. a rename-only PATCH writes
  `before: {"name":"Awards"}`, `after: {"name":"Member recognition"}`), never a full-row
  snapshot — because that's the difference between a log a reviewer can actually read to see
  "what changed, from what, to what" at a glance, versus one that just confirms "category
  edited" and forces a diff against some other historical record to find out what.
- Wrote `drizzle/migrations/0074_ledger_category_audit.sql` — `CREATE TABLE IF NOT EXISTS` +
  a guarded `DO $$ ... END $$` block creating both indexes only if `pg_indexes` doesn't already
  list them, matching the `0068`/`0071` style precedent.
- **Verified idempotency against the dev DB (not prod — `DATABASE_URL`, confirmed a Neon
  branch, not a throwaway):**
  1. `psql "$DATABASE_URL" -c "\d ledger_audit_log"` → confirmed the table did not exist yet.
  2. `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate` (first run) →
     `0074_ledger_category_audit.sql` applied with no NOTICE (clean first create).
  3. `psql "$DATABASE_URL" -c "\d ledger_audit_log"` → table present with all 8 columns, both
     indexes, and both FK constraints (`actor_user_id` → `users(id)` ON DELETE SET NULL,
     `target_category_id` → `ledger_categories(id)` ON DELETE SET NULL) exactly matching
     `schema.ts`.
  4. `pnpm db:migrate` (second run) → Postgres NOTICE `relation "ledger_audit_log" already
     exists, skipping` for the `CREATE TABLE`, and the guarded index block produced no output
     (both `IF NOT EXISTS` checks in `pg_indexes` short-circuited). **Confirmed clean no-op.**
- Attempted `pnpm db:push` afterward to sync Drizzle Kit's view; it hit an **interactive prompt
  unrelated to this feature** — a pre-existing drift on `ledger_entities_slug_unique` (a unique
  constraint Drizzle Kit wants to add to `ledger_entities`, prompting "truncate table?" because
  `pnpm db:push` runs without `--force` locally). This predates my change, touches a table I
  never modified, and I did not resolve it — answering an unattended truncate prompt on a live
  table is out of scope and risky. The actual deploy pipeline runs `drizzle-kit push --force`
  (see `package.json`'s `build` script), which auto-resolves these prompts non-interactively and
  is unaffected. Flagging for whoever next touches `ledger_entities` or runs a bare (non-force)
  `db:push` locally.
- **`src/lib/ledger.ts`:**
  - Added `MAX_CATEGORY_NAME_LENGTH = 120` and `MAX_FORM_990_LINE_LENGTH = 120`, placed next to
    `MAX_BUDGET_LINE_LABEL_LENGTH` per the design doc, app-layer only (DECISION-041 precedent,
    no DB CHECK).
  - Factored a private `validateCategoryNameCore(name, existingNames)` helper (trim → required
    → length-capped → case-insensitive collision) so `validateCategoryCreateInput` and the new
    `validateCategoryEditInput` can't drift on what "too long" or "a collision" means.
  - `validateCategoryCreateInput` now also enforces the 120-char cap (a strictly additive
    change — no existing category name is remotely close to 120 chars, so every currently-valid
    call site is unaffected) via the shared core, then its own `flow` check (create-only).
  - New `validateCategoryEditInput({ name, existingNames })` — the PATCH-side twin for the
    rename path. `existingNames` is documented as caller-supplied and **excluding the
    category's own current name**, so a same-name or case-only rename never false-positives as
    a collision. Returns `{ ok: true; trimmedName }` on success (the caller writes
    `trimmedName`, not the raw input).
  - Did **not** add `form990Line` normalization — Phase 3's `validateCategoryEditInput` spec
    (Unresolved Caps section) is name-only; `form990Line`'s trim/null/length-cap logic is a
    PATCH-route-level validation step per the API contract (item 3), which is api-developer's
    lane, not schema/validator lane. `MAX_FORM_990_LINE_LENGTH` is exported and ready for that
    use.
- Unit tests written in `src/lib/ledger.test.ts` (tests 1–3 from the Phase 3 list, plus small
  boundary/passing-case siblings for confidence):
  - `validateCategoryCreateInput` gains: rejects a name over `MAX_CATEGORY_NAME_LENGTH`, accepts
    a name exactly at the limit.
  - New `describe("validateCategoryEditInput")` block: rejects over-length name; **allows
    renaming a category to its own current name, including a case-only change** (Phase 3 test
    2); **rejects a case-insensitive collision against a sibling category, with the edited
    category's own name excluded from the collision set** (Phase 3 test 3); rejects an
    empty/whitespace-only name; accepts a valid unique rename.
- Ran `pnpm exec tsc --noEmit` — clean, no output.
- Ran `pnpm test` — **987 passed** (980 baseline + 7 new tests: 2 in
  `validateCategoryCreateInput`, 5 in the new `validateCategoryEditInput` block), 0 regressions,
  43 test files.
- Ran `pnpm build:only` — production build passed clean, no new route errors.

### Outputs

- **Schema:** `src/lib/db/schema.ts` — new `ledgerAuditLog` table (`ledger_audit_log`),
  positioned immediately after `ledgerCategories`. Columns: `id`, `actorUserId` (FK →
  `users.id`, `ON DELETE SET NULL`), `action` (text, free-form classifier), `targetCategoryId`
  (FK → `ledgerCategories.id`, `ON DELETE SET NULL`), `before`/`after`/`details` (nullable
  text), `createdAt`. Indexes: `ix_ledger_audit_log_category` (`targetCategoryId`),
  `ix_ledger_audit_log_created` (`createdAt`). Exported types `LedgerAuditLog` /
  `NewLedgerAuditLog`.
- **Migration:** `drizzle/migrations/0074_ledger_category_audit.sql` — `CREATE TABLE IF NOT
  EXISTS` + guarded `DO $$ ... END $$` index creation. **Verified idempotent** by applying
  against the dev DB (`DATABASE_URL`) twice; the second run produced only Postgres "already
  exists, skipping" NOTICEs and no errors (see verification steps above).
- **Tables affected:** new table `ledger_audit_log` only. No changes to `ledger_categories`,
  `ledger_transactions`, `ledger_budgets`, or `ledger_budget_approvals` — matches the Phase 3
  design's "No other schema changes" section exactly.
- **Validators/constants:** `src/lib/ledger.ts` — `MAX_CATEGORY_NAME_LENGTH = 120`,
  `MAX_FORM_990_LINE_LENGTH = 120`, private `validateCategoryNameCore()`, extended
  `validateCategoryCreateInput` (now length-capped), new `validateCategoryEditInput` +
  `CategoryEditValidationInput`/`CategoryEditValidationResult` types.
- **Unit tests:** `src/lib/ledger.test.ts` — 7 new tests (2 create-path length tests, 5 in the
  new `validateCategoryEditInput` describe block, including Phase 3's named tests 2 and 3).
- **Role bindings / seed rows:** none — no new `FEATURES` key (Treasurer Decision 5, reaffirmed
  by DECISION-065/066); existing `LEDGER_MANAGE` binding is unchanged.
- **Local apply command:** `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm
  db:migrate` (already run twice against dev, confirmed idempotent). `pnpm db:push` was
  attempted but hit an unrelated pre-existing interactive prompt on `ledger_entities` (see "What
  I did" above) — not run to completion locally; the deploy pipeline's `drizzle-kit push
  --force` is unaffected by this local-only TTY limitation.
- **Gates:** `pnpm exec tsc --noEmit` — clean. `pnpm test` — 987 passed (0 regressions from the
  980 baseline). `pnpm build:only` — passed.

### Open questions / handoff notes (for api-developer)

- `ledgerAuditLog` is live in `schema.ts` and the dev DB; `LedgerAuditLog`/`NewLedgerAuditLog`
  types are exported for the audit-write helper you'll add inside
  `ledger-category-queries.ts` (per DECISION-065 — do not extract a shared `logLedgerAudit()`
  helper yet, no second caller exists).
- `validateCategoryEditInput({ name, existingNames })` is ready to call from the `PATCH
  /api/admin/ledger/categories/[id]` route's `name` branch. **You must exclude the category's
  own current name from `existingNames` before calling it** — the function does not do that
  exclusion itself, by design (mirrors how `validateCategoryCreateInput`'s `existingNames` is
  pre-scoped by the caller via `getCategories()`). Returns `{ ok: true; trimmedName }` — write
  `trimmedName`, not the raw request body value.
- `validateCategoryCreateInput` now rejects names over 120 chars (a pre-existing, unaffected
  behavior change — no current category name is anywhere close to that length, confirmed
  against the live categories, but worth knowing if `POST /categories`' existing error-handling
  tests assumed no length ceiling existed).
- `MAX_FORM_990_LINE_LENGTH = 120` is exported but **unused by any validator I wrote** — per
  Phase 3, `form990Line`'s trim/null-on-empty/length-cap logic is PATCH-route-level validation
  (API contract step 3), your lane. No shared helper exists for it yet since there's only the
  one call site described in the design.
- The `ledger_entities_slug_unique` interactive-prompt drift on `pnpm db:push` (no `--force`) is
  **pre-existing and unrelated** to this feature — do not attempt to fix it as part of this
  work; it doesn't block `db:migrate`, `tsc`, `pnpm test`, or `pnpm build:only`, all of which
  pass clean.
- Next: build `src/lib/ledger-category-queries.ts` and the four route files per the Phase 3 API
  contracts, using `validateCategoryCreateInput`/`validateCategoryEditInput` as specified above.
  Unit tests 4–12 from the Phase 3 list are your deliverable.

---

## Phase 4 — Implementation (API) — 2026-08-07

**Owner:** api-developer
**Status:** complete

### Summary

Built the full server-side surface for Ledger Category Management per the Phase 3 contracts:
a new sibling module `src/lib/ledger-category-queries.ts` (list/impact/update/merge queries +
the audit-write helper) and four route files under
`src/app/api/admin/ledger/categories/**`. Did not touch `ledger-queries.ts` beyond consuming
`getEntityById`/`getFunds`/`getCategories`/`assertBudgetUnlocked` unchanged, and did not touch
`scripts/`. Wrote all 9 of Phase 3's named tests 4–12 (tests 1–3 were database-admin's), plus a
handful of boundary siblings for confidence. All three gates are green with zero regressions.

### What I did

- Read Phase 1/2/3, DECISION-065/066, the database-admin Phase 4 handoff, and both precedent
  scripts (`scripts/apply-fy2026-budget-review.ts`, `scripts/merge-club-budget-categories.ts`)
  in full before writing any code.
- **`src/lib/ledger-category-queries.ts` (new):**
  - `getCategoryById(id)` — active-or-inactive lookup (unlike `getCategories()`, which always
    filters `isActive=true`); used by the PATCH route's 404 check and by `getCategoryImpact`/
    `mergeCategories`.
  - `listCategoriesForAdmin(entityId, { fundKind?, flow?, includeInactive? })` — the GET list
    route's query. A separate function from `getCategories()` rather than bolting an
    `includeInactive` param onto it, since every existing caller of `getCategories()` relies on
    its "active only, no exceptions" behavior for picker-style consumption.
  - `toCategoryDTO(category)` — the shared list/PATCH response shape (full row minus `entityId`).
    Lives here, not in a route.ts file — Next.js App Router route modules may only export
    recognized HTTP-method handlers plus a small config allowlist; an extra named export in a
    route.ts fails the build's route type-check (discovered this the hard way on the first pass —
    initially exported it from `categories/route.ts` and imported it into `[id]/route.ts`, which
    typechecked fine locally but is documented as unsupported by Next's route-type generation, so
    I moved it into the query module before it could surface as a build-time surprise).
  - `getCategoryImpact(categoryId)` — the one-query/three-caller impact response. `postedGivingCents`
    reuses `getPhilanthropy`'s exact WHERE conditions (`ledger-queries.ts:4705-4712`, minus
    `countsAsGiving`) scoped to the category, with a short-circuit to `0` (no query issued) for
    income-flow or administrative-fund categories, since a category is scoped 1:1 to a fundKind
    per entity and such a category's transactions could never pass `getPhilanthropy`'s own filter
    regardless of transaction data — verified this short-circuit is safe, not just fast, and
    covered it with an explicit unit test (Phase 3 test 9's "0 for income-flow/administrative-fund"
    clause) rather than trusting the SQL filter alone in a mocked-DB test.
  - `updateCategory(categoryId, patch, actorUserId)` — one general function (not three separate
    `renameCategory`/`updateCategoryFlags`/`setCategoryActive` functions — DECISION-065 explicitly
    allows either shape) covering rename/`countsAsGiving`/`form990Line`/`isActive` in a single
    Drizzle transaction: re-reads the row inside the transaction, computes an only-the-changed-
    fields diff, writes the UPDATE + one `ledgerAuditLog` row atomically, and skips the audit
    write entirely on a true no-op patch (e.g. renaming to the exact current name — no write, no
    audit row, matching "before/after always capture every changed field" read literally: if
    nothing changed, there's nothing to capture).
  - `determineCategoryUpdateAction(changed)` — the DECISION-066 item 6 precedence rule, factored
    out as a small pure function and exported for direct unit testing without a DB.
  - `mergeCategories({ sourceId, destinationId, confirm, actorUserId })` — one function, one
    refusal-order (identical for `confirm:false` and `confirm:true`, matching architect Ruling #5
    exactly): missing/same id (400) → either category missing (404) → scope mismatch (400) →
    destination inactive (409) → current-FY lock via `assertBudgetUnlocked` (409) → source has any
    transactions, count in the message (409) → any fiscal year with a budget row on both sides,
    year(s) named (409). `confirm:true` re-runs every check fresh rather than trusting a
    previously-computed plan (no time-of-check/time-of-use gap). On apply: re-points each
    non-conflicting year's `ledger_budgets.category_id` and writes one `category_merged` audit row
    (`before`/`after` both `null` — merge is a structural two-category re-point, not a field flip;
    the affected fiscal years live in `details`), all inside one `db.transaction`. Source category
    is never touched otherwise — matches both scripts exactly.
- **Routes:**
  - `categories/route.ts` — added `GET` (list+filter: `entityId` required, `fundKind`/`flow`/
    `includeInactive` optional). Existing `POST` untouched.
  - `categories/[id]/route.ts` (new) — `PATCH`, the general edit endpoint. Validation order
    matches the Phase 3 contract exactly: 404 existence check first, then name (trim/length/
    collision via `validateCategoryEditInput`, existingNames sourced from `getCategories()` scoped
    to the category's own `(entityId, fundKind, flow)` and filtered to exclude the row's own id),
    then `form990Line` (trim/null-on-empty/length cap against `MAX_FORM_990_LINE_LENGTH`), then
    `countsAsGiving`/`isActive` boolean checks, then the empty-body 400.
  - `categories/[id]/impact/route.ts` (new) — `GET`, thin pass-through to `getCategoryImpact`.
  - `categories/merge/route.ts` (new) — `POST`, thin pass-through to `mergeCategories`; only does
    basic string-type presence checking at the route layer, delegating all business validation
    (missing/same id, scope, lock, transactions, collision) to the query function so the plan and
    apply paths can never diverge.
  - All four routes: `auth()` → 401, then `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)` →
    403, in that order, before any DB access — matches every existing Ledger route in this app.
- **Tests written** (Phase 3's named tests 4–12, database-admin already delivered 1–3):
  - `src/lib/ledger-category-queries.test.ts` (24 tests) — `determineCategoryUpdateAction`
    precedence (pure); `updateCategory` audit-row-per-operation-type (rename, deactivate,
    reactivate, flags-only, simultaneous rename+deactivate showing the precedence rule, 404, and
    the no-op-writes-nothing case) — **test 10**; `mergeCategories` — source-has-transactions with
    exact count in the message including the singular/plural boundary (**test 4**), same-FY
    both-sides budget collision naming the year (**test 5**), inactive destination refusal then
    success once reactivated (**test 6**), `confirm:false` plan vs `confirm:true` apply agreement
    across 2 non-conflicting fiscal years including asserting the actual `UPDATE` calls and audit
    row (**test 7**), plus same-id/scope-mismatch/lock refusal siblings; `getCategoryImpact` —
    FY2024(locked)/FY2026(unlocked) budget-line counts (**test 8**), and `postedGivingCents`
    correctness — both the income-flow/administrative-fund 0-short-circuit and, for an eligible
    category, a structural WHERE-clause assertion (via `PgDialect().sqlToQuery()`, the same
    technique `ledger-queries.test.ts`'s `asOfDate` bounding tests already use) proving the query's
    params are byte-identical in content/order to `getPhilanthropy`'s own filter (**test 9**).
  - Four `route.test.ts` files (27 tests total) — permission gate (401/403, asserting the query
    layer is never touched) for all four routes (**test 11**); PATCH's empty-body 400 with no
    `updateCategory` call (**test 12**), plus its name-collision/form990Line-length/boolean-type
    validation paths; GET list's entityId-required/entity-not-found/includeInactive pass-through;
    impact GET's 404/200 pass-through; merge POST's missing-ids 400 and plan/apply/refusal
    pass-through. Route tests mock the query module rather than the DB — the business logic those
    routes call into is already proven at the query layer, so route tests only need to prove
    wiring (auth order, input shape, response shape).
  - Found and fixed one test-authoring bug along the way: `vi.mocked(fn).mockResolvedValue(...)`
    set once in `beforeEach` does NOT reset a mock's call history between tests — an early
    `[id]/route.test.ts` draft had two validation tests spuriously fail because a prior test's
    successful `updateCategory` call was still in the mock's cumulative call log. Fixed by adding
    `vi.clearAllMocks()` to every new route test file's `beforeEach`, ahead of the resolved-value
    setup calls.
- Ran `pnpm exec tsc --noEmit` — clean.
- Ran `pnpm test` — **1038 passed** (987 baseline + 51 new: 24 in `ledger-category-queries.test.ts`,
  27 across the four route test files), 0 regressions, 48 test files.
- Ran `pnpm build:only` — production build passed clean; all four new/changed routes
  (`/api/admin/ledger/categories`, `/[id]`, `/[id]/impact`, `/merge`) appear in the route manifest
  with no build errors.

### Outputs

**New module:** `src/lib/ledger-category-queries.ts` — exports `getCategoryById`,
`listCategoriesForAdmin`, `toCategoryDTO`, `getCategoryImpact` (+ `CategoryImpact`/
`CategoryImpactFiscalYear` types), `updateCategory` (+ `CategoryUpdatePatch`/
`CategoryUpdateResult` types), `determineCategoryUpdateAction` (+ `CategoryUpdateAction` type),
`mergeCategories` (+ `MergeCategoriesInput`/`MergeCategoriesResult`/`MergePlanEntry` types).

**Endpoints (all gate: `auth()` → 401, then `hasFeature(session.user.id, FEATURES.LEDGER_MANAGE)` → 403):**

- `GET /api/admin/ledger/categories`
  Query: `entityId` (required), `fundKind`/`flow` (optional, validated against the fixed enums),
  `includeInactive` (optional, `"true"` to include deactivated rows).
  200: `{ categories: LedgerCategoryDTO[] }` (id, name, fundKind, flow, sortOrder, isActive,
  countsAsGiving, form990Line, createdAt, updatedAt — no entityId), ordered `sortOrder, name`.
  Errors: 400 (missing/invalid entityId/fundKind/flow), 401, 403, 404 (entity not found).

- `PATCH /api/admin/ledger/categories/[id]`
  Body: any non-empty subset of `{ name?: string; countsAsGiving?: boolean; form990Line?: string | null; isActive?: boolean }`.
  200: updated `LedgerCategoryDTO`.
  Errors: 400 (empty body / invalid field types / over-length name or form990Line), 401, 403,
  404 (category not found), 409 (case-insensitive name collision within the category's own
  `(entityId, fundKind, flow)`, excluding itself).
  No lock check on rename (Treasurer Decision 1). Deactivate/reactivate are both unconditional at
  this layer (the open-balance warning is `GET .../impact`'s job, never a server-side block).

- `GET /api/admin/ledger/categories/[id]/impact`
  No body. 200: `CategoryImpact` — `{ category, transactions: { total, postedGivingCents },
  budgetLines: { total, fiscalYears: [{ fiscalYear, entityName, fundName, flow,
  annualAmountCents, locked }] }, openBalance: { currentFiscalYear, hasNonLockedBudgetRow,
  currentFyBudgetedCents } }`.
  Errors: 401, 403, 404 (category not found).

- `POST /api/admin/ledger/categories/merge`
  Body: `{ sourceId: string; destinationId: string; confirm?: boolean }`.
  `confirm` false/omitted → 200 `{ plan: [{ fiscalYear, entityName, fundName, annualAmountCents,
  locked }], sourceTransactionCount, destinationName }`, no writes.
  `confirm: true` → 200 `{ merged: true, destinationId, affectedFiscalYears: number[] }`.
  Errors: 400 (missing/same id, scope mismatch), 401, 403, 404 (either category), 409
  (destination inactive / current-FY locked / source has transactions, count in message /
  same-year both-sides budget collision, year(s) named).

**Schema changes:** none in this phase — `ledgerAuditLog` was added by database-admin in the
prior Phase 4 (schema) section; this phase only writes to it.

**Tests:** `src/lib/ledger-category-queries.test.ts` (new, 24 tests), plus four new
`route.test.ts` files: `categories/route.test.ts`, `categories/[id]/route.test.ts`,
`categories/[id]/impact/route.test.ts`, `categories/merge/route.test.ts` (27 tests total).

**Gates:** `pnpm exec tsc --noEmit` — clean. `pnpm test` — 1038 passed (0 regressions from the
987 baseline this phase started with). `pnpm build:only` — passed, all four new/changed routes
present in the manifest.

### Open questions / handoff notes (for ux-developer)

- All four endpoints above are live, tested, and typecheck/build clean — the request/response
  shapes documented in "Outputs" are the contract to build against. The existing `POST
  /api/admin/ledger/categories` (create) is unchanged.
- `toCategoryDTO` is exported from `@/lib/ledger-category-queries` if you need the same shape
  client-side for optimistic UI or type reference — but per Phase 3's UI Design section, the
  Categories page itself is a Server Component expected to fetch via `getCategories`/
  `listCategoriesForAdmin`-family calls directly, not round-trip through `GET
  /api/admin/ledger/categories`. That GET route exists for client-component re-fetch scenarios
  (e.g. the merge dialog's destination picker, or any client-side filter/search that needs fresh
  data) — your call on whether the initial page render uses it or calls `listCategoriesForAdmin`
  directly from the Server Component (both are exported and safe to use in a Server Component).
- `GET .../impact`'s `budgetLines.fiscalYears` includes **every** fiscal year with a budget row,
  not just the current one — the rename dialog should show all of them (flagging `locked: true`
  entries per Treasurer Decision 1), not filter down to the current year.
- Merge's `plan` response's `locked` flag is informational only, never a block — Treasurer
  Decision 1/DECISION-066 item 3. The UI should surface it but not gray out or disable the
  confirm button for a locked-year-only plan.
- `PATCH`'s `isActive: true` (reactivate) and `isActive: false` (deactivate) are the same
  endpoint/body shape — no separate reactivate route exists or is needed. Wire the "Reactivate"
  row action (Phase 3 UI Design, Coordinator decision: ships in v1) straight to `PATCH { isActive:
  true }`.
- `form990Line: ""` or `form990Line: "   "` in a PATCH body both store `NULL` (clearing the
  field) — the UI doesn't need to convert an empty text input to `null` itself before sending.
- One thing I deliberately did NOT build: any UI. No components, no pages, no `settings/page.tsx`
  nav-card addition. Phase 3's full UI Design section (page route, filter bar, row actions,
  component list, `<ConfirmDialog>` usage, mobile/accordion layout) is your spec — I didn't
  pre-decide any of the "exact file boundaries are ux-developer's call" items it explicitly left
  open (e.g. whether `category-flags-dialog.tsx` is its own file or folded into rename).
- Next: `ux-developer` builds `src/app/(dashboard)/admin/ledger/settings/categories/page.tsx`,
  the nav-card addition to `settings/page.tsx`, and the client components under
  `src/components/admin/ledger/` per Phase 3's UI Design section, then does the manual
  click-through of every flow before handing to `qa`.

---

## Phase 4 — Implementation (UI) — 2026-08-07

**Owner:** ux-developer
**Status:** complete

### Summary

Built `/admin/ledger/settings/categories` — entity → fund-kind → flow grouped category
list with filter/search, and all four operations (rename, deactivate/reactivate, edit
flags, merge) — entirely on top of the API contract api-developer shipped. Extracted the
grouping/filtering/merge-destination logic into a pure `src/lib/ledger-category-ui.ts`
module (this project has no RTL/jsdom, so pure-function tests are the seam) rather than
burying it in the client component, and wrote 17 unit tests against it. Did not touch
`schema.ts`, `ledger-category-queries.ts`, or any route file. All three gates green with
zero regressions.

### What I did

- Read Phase 1/2/3, DECISION-065/066, and both prior Phase 4 handoffs in full before
  writing any code. Consumed the four endpoints exactly as documented by api-developer —
  no contract surprises, no round-trip back to api-developer needed.
- **`src/lib/ledger-category-ui.ts` (new)** — pure, DB-independent helpers: `AdminCategoryRow`/
  `EntityCategoryData` types (a client-safe narrowing of `toCategoryDTO`'s shape, dates
  stripped since the UI never needs them), `filterCategoryRows()` (search/fundKind/flow/
  showInactive over an already-fetched list), `groupCategoriesByFundKind()` (orders fund
  kinds administrative → charitable → activity → scholarship, matching `getFunds()`'s own
  ORDER BY, and omits empty groups rather than rendering blank accordion sections), and
  `getMergeDestinationOptions()` (same-entity/fundKind/flow, active-only, excludes the
  source itself — client-side narrowing only, the server independently re-validates scope
  and destination-active on both the plan and apply calls). `fundKindLabel()` resolves a
  category's bare `fundKind` string to the real fund's display name (e.g. "Activity Fund")
  via the entity's `getFunds()` list rather than inventing a parallel label constant —
  there wasn't one in this codebase to reuse.
- **`src/lib/ledger-category-ui.test.ts` (new)** — 17 tests: `filterCategoryRows` (inactive
  excluded by default / included via `showInactive`, fundKind filter, flow filter,
  case-insensitive search, all filters combined), `groupCategoriesByFundKind` (fixed fund-
  kind order, empty groups omitted, income/expense split, sortOrder-then-name ordering
  within a flow, unknown fund kinds sort alphabetically after the known set —
  defensive, none exist today), `getMergeDestinationOptions` (excludes self/inactive/
  wrong-scope, sorts eligible destinations), `fundKindLabel` (matches a real fund, falls
  back to a capitalized fundKind when none matches — e.g. the fund itself was
  deactivated).
- **`src/app/(dashboard)/admin/ledger/settings/categories/page.tsx` (new)** — Server
  Component, same `auth()` → `hasFeature(LEDGER_MANAGE)` → redirect-to-`/admin/ledger`
  guard as `settings/page.tsx`. Fetches `getEntities()`, then per entity
  `getFunds(entity.id)` and `listCategoriesForAdmin(entity.id, { includeInactive: true })`
  (both exported by api-developer specifically for Server Component use, per their
  handoff note) in parallel, maps through `toCategoryDTO` and narrows to
  `AdminCategoryRow` before handing the whole dataset to the client `CategoryList` — one
  fetch for the whole page, no per-filter round trip for a ~100-row list (Phase 3 UI
  Design).
- **`src/components/admin/ledger/category-list.tsx` (new)** — the client-owned filter
  state + dialog orchestration. Entity tabs (local state, not a URL param — this is
  narrowing over an already-fetched dataset, not a page navigation, so I didn't reuse
  `entity-switcher.tsx`'s URL-driven pattern), fund/flow selects, a "Show inactive"
  checkbox (default off, matching every existing category picker), and a search-as-you-
  type box, all client-side over the pre-fetched list (`donor-list.tsx`'s established
  idiom for ~100-row admin lists). Fund-kind sections render as native `<details open>`
  accordions (Phase 3's "stack of expandable sections" mobile answer — no accordion
  primitive exists in `src/components/ui/`, and `<details>` is the zero-dependency,
  keyboard-accessible way to get that without inventing one), each containing an
  Income/Expense `<table>` — this genuinely is tabular data (name, giving flag, 990 line,
  actions), so it stays a `<table>` inside `overflow-x-auto` per CLAUDE.md's "tables that
  act like tables stay as `<table>`," matching `donor-list.tsx`/
  `reconciliation-match-picker.tsx`'s exact wrapper pattern. Empty states: "no categories
  at all for this entity" (CTA: New Category) vs. "no categories match your filters" (CTA:
  Clear filters), both `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` per CLAUDE.md.
  Row actions are `flex flex-wrap` text buttons — I checked for an existing kebab/overflow-
  menu convention on admin ledger tables (Phase 3 UI Design suggested one) and found
  **no such precedent anywhere in the 34-file `src/components/admin/ledger/` tree**;
  `transaction-actions.tsx` and `donor-list.tsx` both use exactly this flex-wrap text-
  button pattern and let it wrap to a second line at narrow widths instead. I followed the
  actual precedent rather than inventing a new one, per Phase 3's own instruction
  ("ux-developer to confirm the existing pattern/component, not invent a new one").
  Active-row actions: Rename, Edit flags, Merge into…, Deactivate. Inactive rows render
  muted (`text-gray-400 line-through` name + gray "Inactive" badge, `bg-gray-50` row) with
  Reactivate + Rename only, per Phase 3's UI Design / the Coordinator's v1 sign-off on
  reactivation.
- **`src/components/admin/ledger/category-rename-dialog.tsx` (new)** — fetches
  `GET .../impact` on open, shows the transaction/budget-line counts and every fiscal year
  affected (locked years get an amber "locked" chip), name input with a live
  `MAX_CATEGORY_NAME_LENGTH` (120) counter. If any locked year is present, Save routes
  through a non-destructive `<ConfirmDialog>` naming exactly which locked years will
  relabel before committing; otherwise it's a plain PATCH. This is the flow Treasurer
  Decision 1 calls "the single most important interaction in the feature" — impact is
  always visible before the name can change, never after.
- **`src/components/admin/ledger/category-flags-dialog.tsx` (new)** — `countsAsGiving`
  checkbox + `form990Line` text input (120-char cap). Fetches `GET .../impact` on open
  unconditionally so `postedGivingCents` is visible regardless of which way the toggle is
  about to move (matches the API's own "computed regardless of current value" design).
  Flipping `countsAsGiving` routes through `<ConfirmDialog destructive>` quoting the exact
  dollar figure and stating it changes `/members/impact` "effective immediately"; editing
  only `form990Line` saves directly — no dollar impact, so no confirm gate, consistent
  with the rename dialog's "plain save when nothing risky changed" pattern. A patch only
  ever includes the field(s) that actually changed.
- **`src/components/admin/ledger/category-merge-dialog.tsx` (new)** — destination `<select>`
  built from `getMergeDestinationOptions()`, auto-fetches the `confirm:false` plan on every
  destination change, and renders either the per-fiscal-year plan (amount + a "locked"
  chip, informational only — Merge button is never disabled by a locked year, per
  DECISION-066 item 3) or the 409 body's `error` string **verbatim** — Treasurer Decision 2
  requires the refusal reason and its count to be shown plainly, and the route already
  phrases that message with the exact transaction count / conflicting fiscal years, so the
  dialog doesn't reconstruct or paraphrase it. Confirm routes through
  `<ConfirmDialog destructive>` before the `confirm:true` apply call. Zero-eligible-
  destination case (no other active category shares this entity/fundKind/flow) shows an
  explicit empty state instead of an unusable empty `<select>`.
- **`src/components/admin/ledger/category-deactivate-confirm.tsx` (new)** — no separate
  dialog shell, just a `<ConfirmDialog destructive>` whose description is built from a
  `GET .../impact` fetch triggered on open (nullable-target pattern, mirroring
  `donor-list.tsx`'s `deleteId` state). `openBalance.hasNonLockedBudgetRow` renders as an
  appended warning sentence inside the description — informational, never disables the
  Deactivate button (DECISION-066 item 4: warning, not a block).
- **`src/components/admin/ledger/category-create-dialog.tsx` (new)** — the "+ New Category"
  second entry point onto the **existing, unchanged** `POST /api/admin/ledger/categories`
  (entity/fund/flow selects default to the currently active tab's first fund; changing
  entity resets the fund select to the new entity's first fund rather than leaving a
  stale cross-entity value selected). Same validation/error surface as the pre-existing
  Guided Budgeting inline flow — no new server-side behavior.
- **`src/app/(dashboard)/admin/ledger/settings/page.tsx` (edited)** — added one
  `rounded-2xl` interactive nav card ("Manage Categories") linking to
  `/admin/ledger/settings/categories`, styled identically to this app's other
  clickable-card convention (`shadow-lg hover:shadow-xl ... hover:-translate-y-1`),
  placed above the existing settings form.
- Ran `pnpm exec tsc --noEmit` — clean.
- Ran `pnpm test` — **1055 passed** (1038 baseline + 17 new, all in
  `ledger-category-ui.test.ts`), 0 regressions, 49 test files.
- Ran `pnpm build:only` — production build passed clean; `/admin/ledger/settings/categories`
  and all four `/api/admin/ledger/categories/**` routes present in the route manifest, no
  build warnings or errors anywhere in the output.
- Ran `pnpm lint` — pre-existing, unrelated tooling failure (`ESLint`'s `eslintrc` shim
  throws `SyntaxError: The requested module 'minimatch' does not provide an export named
  'default'` before it reaches any file — a Node/ESM interop break in a transitive
  dependency, not something this change introduced or could fix from application code).
  Not run to a clean pass; flagging for deployment-engineer's dependency review rather
  than silently working around it.

### Outputs

- **New files:**
  - `src/lib/ledger-category-ui.ts` — pure grouping/filtering/merge-destination helpers +
    `AdminCategoryRow`/`EntityCategoryData`/`FundKindGroup` types.
  - `src/lib/ledger-category-ui.test.ts` — 17 unit tests.
  - `src/app/(dashboard)/admin/ledger/settings/categories/page.tsx` — Server Component page.
  - `src/components/admin/ledger/category-list.tsx` — filter/search + grouped accordion +
    dialog orchestration.
  - `src/components/admin/ledger/category-rename-dialog.tsx`
  - `src/components/admin/ledger/category-flags-dialog.tsx`
  - `src/components/admin/ledger/category-merge-dialog.tsx`
  - `src/components/admin/ledger/category-deactivate-confirm.tsx`
  - `src/components/admin/ledger/category-create-dialog.tsx`
- **Edited:** `src/app/(dashboard)/admin/ledger/settings/page.tsx` — one nav-card addition,
  no other change.
- **Decisions logged:** none new — every open UI-surface question Phase 3 left to
  ux-developer (kebab-vs-flex-wrap row actions, accordion vs. tab layout, dialog file
  boundaries) was resolved by following an existing in-tree precedent rather than
  inventing structure, so nothing rose to a `docs/decisions.md`-worthy call.
- **Gates:** `pnpm exec tsc --noEmit` — clean. `pnpm test` — 1055 passed (0 regressions
  from the 1038 baseline). `pnpm build:only` — passed, new route + all four API routes in
  the manifest. `pnpm lint` — pre-existing, unrelated ESLint/minimatch ESM breakage (see
  above), not introduced by this change.

### Open questions / handoff notes (for qa)

- **Manual click-through checklist** (no RTL/jsdom in this project, so this phase's tests
  stop at the pure-logic seam — qa's dev-server smoke test is the first place these flows
  actually render):
  - Rename a category with no locked-year budget rows → plain save, no confirm dialog.
  - Rename a category that has a locked FY budget row (e.g. any FY2025 line) → impact
    panel shows the locked year with an amber "locked" chip, Save opens the non-destructive
    `<ConfirmDialog>` naming the locked year(s), confirming updates the name everywhere.
  - Rename to a name that collides case-insensitively with a sibling in the same
    (entity, fundKind, flow) → 409 surfaces as a toast, dialog stays open with the typed
    name preserved.
  - Deactivate a category with an open, non-locked current-FY budget row → warning
    sentence appears inside the ConfirmDialog body; deactivating still succeeds (warning,
    not a block).
  - Deactivate a category with no open balance → plain confirm description, no warning
    line.
  - Reactivate a deactivated category → row moves back to the active-styled group, actions
    return to the full set.
  - Edit flags: toggle `countsAsGiving` on a category with posted giving-eligible
    transactions → dollar figure shown before commit, `<ConfirmDialog destructive>`
    quotes it, save persists.
  - Edit flags: change only `form990Line` → saves directly, no confirm dialog.
  - Merge: pick a destination, confirm the per-year plan renders with correct amounts and
    any locked-year chip; complete the merge and confirm the source category remains
    listed (inactive-eligible or active) with zero budget rows afterward.
  - Merge: pick a source that has transactions → the 409's exact count-bearing message
    renders in the plan panel, Merge button stays disabled (no plan was ever set).
  - Merge: pick a destination that would collide on a shared fiscal year → the exact
    "resolve by hand" message with the named year(s) renders.
  - "+ New Category": create in each of the two entities, confirm it lands in the correct
    fund-kind/flow group once the dialog closes and `router.refresh()` re-fetches.
  - Search box, fund/flow filters, and "Show inactive" checkbox — confirm they compose
    correctly (e.g. searching while a fund filter is active narrows within that fund only).
  - Mobile at 360px: confirm the toolbar wraps sanely, `<details>` sections collapse, and
    each table scrolls horizontally inside its own container rather than the page body
    scrolling sideways.
  - Nav card on `/admin/ledger/settings` links correctly to `/admin/ledger/settings/categories`.
- **New copy strings the Lions Club may want to refine:** "Rename" dialog's locked-year
  disclosure sentence ("A category name is a label, not a figure…" — lifted from Treasurer
  Decision 1's own rationale, but may read as too on-the-nose in a live UI); the merge
  dialog's static explainer line ("Only supported when the source has zero
  transactions…"); the empty-state copy on a brand-new entity with zero categories.
- **UX decisions/tradeoffs made in this phase:**
  1. Entity/fund/flow/search/show-inactive filters are **local client state, not URL
     params** — unlike `entity-switcher.tsx` and `search-filters.tsx` elsewhere in
     `/admin/ledger`, which push to the URL. This page's filters narrow an
     already-fully-fetched dataset rather than triggering a new server fetch or being
     something worth deep-linking to (there's no obvious "share this exact category
     filter" use case the way there is for the ledger search page). Flag if the treasurer
     wants filter state to survive a page refresh or be shareable — that would mean
     switching to `useSearchParams`/`router.push`, a small, contained change.
  2. **Row actions use the existing flex-wrap text-button pattern, not a kebab/dropdown
     menu** — Phase 3's UI Design speculated a kebab menu might already exist elsewhere in
     this table tree "to confirm, not invent." I checked; it doesn't exist anywhere in
     `src/components/admin/ledger/`. I followed the actual, universal precedent
     (`donor-list.tsx`, `transaction-actions.tsx`) instead of introducing the first
     dropdown-based row-action menu in this feature area.
  3. **Fund-kind accordion sections default to `open`** (native `<details open>`) rather
     than starting collapsed — with only up to 4 fund kinds x 2 flows per entity, starting
     open avoids an extra click to see anything at all on first load; the accordion's real
     job is letting the treasurer collapse sections she doesn't care about, not hiding
     content by default. Easy to flip to closed-by-default if it turns out to be too much
     scroll on a category-heavy entity.
- **Next:** qa — dev-server smoke test, the manual click-through list above, and the
  standard Build Verification Report. This is the last increment of Ledger Category
  Management before Phase 6 (analyst, shipped-vs-intent).

---

## Phase 4 — Implementation (merge lock-block loop-back) — 2026-08-07

**Owner:** full-stack-developer
**Status:** complete

### Summary

**Phase 6 → Phase 4 loop-back.** The analyst's Phase 6 review (below) found that `mergeCategories()`
fetched and re-pointed budget rows for every fiscal year the source category had ever touched,
including locked ones — broader than `scripts/merge-club-budget-categories.ts`, which the design
doc claimed it matched "exactly" (DECISION-066 item 3), but which is hardcoded to a single fiscal
year and explicitly declines to touch a locked prior year. The treasurer reviewed that finding and
made a new decision before shipping: merge now **refuses the whole operation**, naming the locked
fiscal year(s), whenever any year it would re-point is locked — a whole-merge refusal, not a
partial merge that quietly skips just the locked year(s) and proceeds for the rest. Implemented
the check, the refusal messaging, the dialog copy, the corrected/superseding decision-log entry,
and unit + e2e coverage. Small, tightly-scoped change across the query layer, one route doc
comment, and the merge dialog — no schema change, no new endpoint.

### What I did

- Read the Phase 6 section of this work-log (analyst's finding and the "Reconcile merge's
  cross-fiscal-year scope" follow-up), DECISION-066, and `scripts/merge-club-budget-categories.ts`'s
  header comment before touching any code.
- Considered partial-merge-with-skipped-years vs. whole-merge-refusal (per the loop-back brief) and
  chose **whole-merge refusal**, per the treasurer's own stated preference and the reasoning already
  in the brief: a partial merge leaves one category's history split across two names with no
  obvious record of why, which is harder to reason about later than simply refusing and telling the
  treasurer which year to unlock.
- **`src/lib/ledger-category-queries.ts`** (`mergeCategories()`): added a new refusal step 8, after
  the both-sides-budget-collision check (step 7) and before the plan is returned to the caller —
  filters the already-computed `plan[]` for `locked: true` entries and, if any exist, refuses the
  entire call (for both `confirm:false` and `confirm:true`, since both run the same code path
  through this point) with a message naming every locked year (`FY2024`, or `FY2024, FY2025` with
  correct singular/plural "is"/"are" grammar) and explaining why ("merging moves a budgeted amount
  between categories, not just a label... a locked, board-approved fiscal year's budget can't be
  changed this way"). Updated the module's top-of-file doc comment and the function's doc comment
  to describe the new behavior and note `MergePlanEntry.locked` now always reads `false` on any
  plan actually returned to a caller (a `true` entry only exists transiently, internally, right
  before the function refuses).
- **`src/app/api/admin/ledger/categories/merge/route.ts`**: added refusal step 8 to the doc comment
  (thin pass-through route, no behavior change needed there — `mergeCategories()` already returns
  the right status/error shape the route already forwards verbatim).
- **`src/components/admin/ledger/category-merge-dialog.tsx`**: updated the dialog's top doc comment
  and the `Dialog.Description` copy to plainly explain the new block, consistent with how the other
  refusals are already surfaced (the existing generic `refusalError` paragraph already renders any
  409 body's `error` string verbatim, so no new UI branch was needed for the refusal itself — only
  the explanatory copy). The amber "locked" chip in the plan-row list is now unreachable in
  practice (a plan is only ever returned when nothing in it is locked) but left in place as
  defensive/forward-compatible display rather than removed, with a comment explaining why.
- **`docs/decisions.md`**: added **DECISION-067**, which (a) documents that DECISION-066 item 3's
  "matches both precedent scripts exactly" claim was wrong, with the specific reason
  (`merge-club-budget-categories.ts` is hardcoded to one fiscal year and explicitly declined to
  touch the locked prior year), and (b) records the treasurer's 2026-08-07 decision and its
  rationale (label vs. figure). Updated DECISION-066's `Status` line to
  "Superseded in part by DECISION-067 (item 3 only...)" and struck through item 3's inaccurate
  sentence in place (not deleted) with an inline correction note pointing to DECISION-067 — per the
  loop-back brief's "do not rewrite history dishonestly" instruction.
- **Unit tests** (`src/lib/ledger-category-queries.test.ts`):
  - Updated the existing "test 7: confirm:false plan and confirm:true apply agree" scenario to use
    two *unlocked* fiscal years (it previously included one locked year in a *successful* merge —
    that assertion is no longer true and would now itself be a false negative if left as-is).
  - Added: refuses the whole merge when a non-current affected year is locked, naming it, and NOT
    mentioning an unaffected year as if it were part of the reason.
  - Added: the same refusal happens identically on `confirm:true`, with no writes.
  - Added: names every locked year with correct plural grammar ("are locked") when more than one
    affected year is locked.
  - Added: does NOT refuse when no affected year is actually locked (guards against an
    over-broad/always-true regression of the new check).
- **e2e** (`e2e/ledger-category-management.spec.ts`): added one new test inside the existing
  `merge refusals` describe block, using the app's own real Approve & Lock API (the fixture qa's
  Phase 5 suite already established) to lock a **non-current** fiscal year (FY2099 — Event costs'
  only real budget row, distinct from the existing "current fiscal year locked" test which uses
  FY2026) and confirm: both `confirm:false` and `confirm:true` refuse, naming FY2099; no write
  occurs (source still holds its budget row); and unlocking makes the same merge preview cleanly
  again, proving the block is genuinely lock-driven. Ran only this spec file against a real local
  dev server (`DATABASE_URL`, never `PROD_DATABASE_URL`) — all 14 tests in the file pass, including
  the new one — then stopped the dev server and deleted `test-results/`/`playwright-report/`. No
  dev-DB state was left mutated by the new test (it only previews/applies against already-refused
  paths and unlocks the fiscal year it locked before finishing).
- Ran `pnpm exec tsc --noEmit` — clean.
- Ran `pnpm test` — **1059 passed** (1055 baseline + 4 new unit tests), 0 regressions, 49 test files.
- Ran `pnpm build:only` — production build passed clean.

### Outputs

- **Modified:** `src/lib/ledger-category-queries.ts` (`mergeCategories()` new refusal step 8 +
  doc-comment updates), `src/app/api/admin/ledger/categories/merge/route.ts` (doc comment only),
  `src/components/admin/ledger/category-merge-dialog.tsx` (doc comment + `Dialog.Description`
  copy), `docs/decisions.md` (new **DECISION-067**; DECISION-066 `Status` line and item 3 corrected
  in place, struck through with an inline note — not silently rewritten).
- **Tests:** `src/lib/ledger-category-queries.test.ts` (1 existing test's fixture corrected + 4 new
  tests); `e2e/ledger-category-management.spec.ts` (1 new test in the `merge refusals` describe
  block).
- **No schema change.** No new endpoint, no new `FEATURES` key.
- **Decision logged:** DECISION-067 (`docs/decisions.md`), correcting DECISION-066 item 3 and
  recording the treasurer's 2026-08-07 decision (whole-merge refusal on any locked affected year).
- **Gates:** `pnpm exec tsc --noEmit` — clean. `pnpm test` — 1059 passed (0 regressions from the
  1055 baseline this loop-back started with). `pnpm build:only` — passed.

### Open questions / handoff notes

- **Phase 5 needs a re-verify scoped to merge**, not a full re-run of the whole feature: confirm
  (a) the new whole-merge refusal fires correctly for a locked non-current year (this loop-back's
  new e2e test already exercises this, but qa should read it and re-run it independently rather
  than trust it on my say-so), (b) the existing merge-success and other-refusal e2e tests still
  pass unchanged (they do — all 14 tests in the file passed together in this session), and (c) the
  DECISION-066/067 pairing in `docs/decisions.md` reads honestly (original wrong claim visible and
  struck through, not deleted; correction clearly dated and cross-referenced).
- Nominating **qa** for the Phase 5 re-verify, then back to **analyst** for a short Phase 6 re-check
  (the original Phase 6 SHIP WITH NOTES follow-up #1 — "Reconcile merge's cross-fiscal-year scope
  with what the precedent actually supports" — is now resolved by this loop-back; analyst should
  confirm the resolution matches what was asked and, if satisfied, mark that follow-up closed
  rather than leaving it open in a stale state).
- Follow-up #5 from Phase 6 ("merge doesn't adjust the destination's budgeted amount — note this in
  the merge dialog copy or treasurer docs") was **not** addressed in this loop-back — it's a
  separate, narrower documentation gap the loop-back brief didn't ask for. Still open.
- Did not touch `scripts/`, per the hard constraint. Did not commit or push, per the standing rule
  and the explicit hard constraint in this loop-back's brief.

---

## Phase 5 — Verification — 2026-08-07

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** Every automated gate is green with zero regressions (tsc clean, 1055/1055 unit tests, production build clean with all five new routes in the manifest), and every destructive operation named in the QA brief — rename (plain and locked-year), deactivate/reactivate, merge (three refusal paths plus a real success), and the `countsAsGiving` retroactive flip — was exercised against real dev-DB data through the actual running app (never mocked) and matched independently-computed SQL ground truth. No native browser dialog fired anywhere in the suite. The permission gate is present, correctly ordered, and correctly keyed on all four routes and the page. All dev-DB mutations made during verification were restored; the one deliberate exception (a disposable QA-only test category, left inactive) is documented below.

### What I did

- Read the work-log in full (Phase 1 analyst review, Phase 2 architect verdict with its seven rulings, Phase 3 tech-lead design and Full API Contracts, and all three Phase 4 sections — schema, API, UI) plus DECISION-065 and DECISION-066 before touching anything.
- Ran the three automated gates from a clean `main` working tree (as left by the three Phase 4 implementers — no code changes made by qa):
  - `pnpm exec tsc --noEmit` — clean, no output.
  - `pnpm test` — **1055/1055 passed**, 49 test files, 0 regressions against the stated baseline.
  - `pnpm build:only` — clean production build; confirmed `/admin/ledger/settings/categories`, `GET/POST /api/admin/ledger/categories`, `PATCH /api/admin/ledger/categories/[id]`, `GET /api/admin/ledger/categories/[id]/impact`, and `POST /api/admin/ledger/categories/merge` all present in the route manifest.
- Read all four route files and the categories settings page top-to-bottom for the feature-gate audit (table below) — did not infer gating from passing tests.
- Read `src/lib/ledger-category-queries.ts` in full (`getCategoryImpact`, `updateCategory`, `determineCategoryUpdateAction`, `mergeCategories`) to confirm the merge/impact transaction-count queries are structurally identical (same `count()` over `ledger_transactions` filtered on `categoryId`), which is *why* the merge refusal message and the impact endpoint's count can never diverge — confirmed this by construction, not just by test.
- Grepped `src/components/admin/ledger/category-*.tsx` and the new page for `window.confirm|alert|prompt` — zero matches. Confirmed every destructive/retroactive action (`Deactivate`, `Merge`, `countsAsGiving` flip, rename-with-locked-year) routes through `<ConfirmDialog>` by reading each component (`category-rename-dialog.tsx`, `category-flags-dialog.tsx`, `category-merge-dialog.tsx`, `category-deactivate-confirm.tsx`, `category-list.tsx`'s reactivate dialog).
- Queried the dev DB (`DATABASE_URL` only — never touched `PROD_DATABASE_URL`) read-only to find real fixture categories spanning the scenarios the brief asked for: a category with transactions across three fiscal years (`Charitable donation out`, Foundation, 39 transactions across FY2024/2025/2095), a giving-eligible category with real posted transactions (`Rudolph Run expenses`, 30 transactions), and several zero-transaction categories for merge testing.
- Computed ground truth independently via SQL for: the multi-FY category's transaction count (39) and budget-line fiscal years (`{2025, 2095, 2097, 2098, 2099}`), and the giving-eligible category's `postedGivingCents` under `getPhilanthropy`'s exact filter (`status='posted'`, no transfer group, `flow='expense'`, fund kind in `activity|charitable|scholarship`) — **$20,434.17 / 2,043,417 cents**.
- Wrote `e2e/ledger-category-management.spec.ts` (13 tests, Playwright/Chromium, real dev server, real sign-in via `signInAsAdmin`) and ran it to a clean pass. This is a **permanent addition to the regression suite**, not a one-off script — see Regression Tests Added.
- Used the app's own already-shipped, `LEDGER_APPROVE`-gated Approve & Lock / Unlock endpoints (`POST /api/admin/ledger/budget-approvals`, `POST .../unlock`) to create and remove the locked-fiscal-year scenarios the brief required, rather than writing to `ledger_budget_approvals` directly — the same thing a treasurer would do by hand, and consistent with this e2e suite's existing black-box discipline (`admin-security.spec.ts`'s own stated precedent: "no test reaches into the DB directly").
- Hit two real bugs in my own test authoring during this pass (documented so the next reader doesn't mistake them for app defects): (1) an unscoped `getByLabel` matched the wrong "Counts toward reported community giving" checkbox because the "+ New Category" dialog carries an identically-labeled checkbox even while closed — fixed by scoping to the open dialog's role; (2) two assertions read `GET .../impact` immediately after a UI-driven mutation, racing the browser tab's own in-flight `fetch` against my separate `page.request` call — fixed by polling (`pollImpactField`) instead of a single immediate read. Both were caught, the underlying app behavior was re-verified as correct once the test was fixed, and any dev-DB state the buggy runs left behind was restored (see Manual Click-Through and Outputs).
- Confirmed final dev-DB state via SQL: every real category's `name`/`isActive`/`countsAsGiving` matches its original value, `ledger_budget_approvals` shows no year left locked, and the FY2099 budget row used for the merge test is back on its original category. Audit-row sanity: read the full `ledger_audit_log` history this suite produced and confirmed every row's `before`/`after` is a clean, readable diff of only the changed field(s) (e.g. `{"name":"Insurance & bonding"}` → `{"name":"Insurance & bonding (QA temp)"}`), and that `category_merged` rows (which have no single field to diff) carry a human-readable `details` string naming the destination and affected fiscal years instead of leaving `before`/`after` misleadingly empty.
- Stopped the dev server and deleted the `test-results/` Playwright artifact directory before finishing.

### Outputs

- **New file:** `e2e/ledger-category-management.spec.ts` — 13 tests, serial, against the real dev DB and a real signed-in admin session. Left in the repository as permanent regression coverage (not committed — no commit was made per the "do not commit" constraint; the file is present in the working tree for the user to review/commit).
- **No source files touched.** Phase 5 is verification-only; every `src/`, `drizzle/migrations/`, and `docs/decisions.md` file is exactly as the three Phase 4 implementers left it.
- **`scripts/` untouched**, per the explicit hard constraint.
- **Dev-DB state:** fully restored except one deliberate, documented leftover — a disposable category named `QA E2E Open Balance <timestamp>` (Club, Activity Fund, expense), created by the "deactivate with open balance" test, left **inactive** with its FY2026 budget row marked `pendingDelete`. Hard delete isn't exposed anywhere in this app by design (Treasurer Decision 4 / `ON DELETE SET NULL` on both FK paths), so "inactive, not deleted" is the correct, in-app-consistent way to retire a QA-only category — matching the precedent already sitting in this dev DB from prior e2e work (`E2E QA New Category`, `E2E QA Trash Bug ...` rows visible in `ledger_categories` before this suite ran). All real, pre-existing categories are back to their original `name`/`isActive`/`countsAsGiving`, and no fiscal year is left locked.

### Type Check

`pnpm exec tsc --noEmit`: **PASS** — clean, no output, including the new e2e spec.

### Unit Tests

`pnpm test`: **PASS**
Total: 1055 | Passed: 1055 | Failed: 0
Duration: ~1.2s
Failures: none. Matches the 1055 baseline stated in the brief exactly — no regression.

### Production Build

`pnpm build:only`: **PASS**
Notes: Clean build, no warnings or errors. Confirmed in the route manifest: `/admin/ledger/settings/categories` (page) and all four category API routes (`/api/admin/ledger/categories`, `/api/admin/ledger/categories/[id]`, `/api/admin/ledger/categories/[id]/impact`, `/api/admin/ledger/categories/merge`).

### End-to-End Tests

`pnpm test:e2e -- e2e/ledger-category-management.spec.ts`: **PASS**
Total: 13 | Passed: 13 | Failed: 0
Duration: ~30-40s per run (varies with dev-server compile warmup on first navigation)
Failures: none in the final run. (Two test-authoring bugs were found and fixed during development of this spec — see "What I did" — neither was an application defect; both were re-verified as passing correctly once the test itself was fixed.)

Per the brief's known-bad baseline note: did **not** run the full `pnpm test:e2e` suite (which includes the five pre-existing failing specs and the intermittent `admin-security` spec) — only the new, scoped spec file, so that baseline is untouched and not re-litigated here.

### Manual Click-Through (exercised via the automated e2e spec, against real dev data, in a real Chromium browser — not code-read-only)

| Flow | Result | Notes |
|------|--------|-------|
| Rename impact accuracy (multi-FY category) | pass | `Charitable donation out` (Foundation): impact endpoint reports `transactions.total=39`, `budgetLines.total=5`, FYs `{2025,2095,2097,2098,2099}` — matches SQL ground truth computed independently before the endpoint was ever called. |
| Merge's transaction-count refusal cites the same count as the impact endpoint | pass | Refusal message reads "...has 39 transactions..." — identical figure, same underlying query. |
| Rename — no locked year | pass | Plain save, no `<ConfirmDialog>`; real category (`Insurance & bonding`) renamed and restored. |
| Rename — locked fiscal year | pass | Locked Foundation FY2025 via the real Approve & Lock API; rename dialog showed the `FY2025 (locked)` chip and the locked-year disclosure sentence; Save routed through a non-destructive `<ConfirmDialog>` naming FY2025; confirmed; renamed; restored name and unlocked FY2025 afterward. |
| `countsAsGiving` dollar impact vs. `getPhilanthropy` | pass | `Rudolph Run expenses`: impact endpoint's `postedGivingCents` = 2,043,417 (= $20,434.17), matching an independent SQL sum under `getPhilanthropy`'s exact WHERE clause. Toggling the flag on through the real UI showed the identical dollar figure in both the pre-commit copy and the `<ConfirmDialog destructive>` body, persisted server-side, then was restored to its original value. |
| Merge refusal — both sides have a budget row in the same FY | pass | `Event costs` → `Service projects` (both Club, FY2099): 409, message names `FY2099` and says "resolve by hand." |
| Merge refusal — inactive destination | pass | Deactivated `Eyeglass recycling`, attempted merge into it: 409 "...it is deactivated. Reactivate it first." Reactivated; same merge then previewed successfully. |
| Merge refusal — current FY locked | pass | Locked Club FY2026 via the real Approve & Lock API; merge attempt in Club scope refused with a lock-related 409; unlocked afterward. |
| A merge that should succeed | pass | `Event costs` → `Charitable donation out` (Club), driven through the real dialog end to end: plan previewed the FY2099 amount, `<ConfirmDialog destructive>` gated the apply, budget row re-pointed in one transaction, source's transaction count stayed 0 (untouched). Restored by merging the row back (itself a second, symmetric real merge). |
| Deactivate — no open balance | pass | Plain `<ConfirmDialog destructive>` with no "Warning:" line for a category with zero budget rows. |
| Deactivate — open, non-locked current-FY balance | pass | Warning line appeared inside the dialog body (`FY2026`, `$1000.00`), Deactivate button stayed enabled (warning, not a block) — deactivation succeeded. |
| Reactivate | pass | Recovered the mis-clicked-deactivate category with one click, no SQL needed. |
| No native browser dialogs | pass | `page.on("dialog", ...)` listener armed for the entire suite; never fired. Backed by a static grep across every new component (zero matches for `window.confirm|alert|prompt`). |
| Permission gate — unauthenticated | pass | `/admin/ledger/settings/categories` redirects an unauthenticated visitor to `/signin`. |
| Permission gate — authenticated without `LEDGER_MANAGE` | not run via e2e (no such fixture user exists in this project's e2e roster) | Covered instead by (a) a direct code read of all four routes and the page confirming `auth()` → `hasFeature(LEDGER_MANAGE)` runs before any DB access in every case, and (b) the implementer's own unit tests (Phase 3 test 11) asserting 401/403 with the query layer never touched. See the Feature-Gate Audit below — this is a code-verified, not just test-verified, PASS. |
| `/members/impact` cross-check for the `countsAsGiving` flip | not run — e2e admin fixture (`lions-e2e-test@westervillelions.org`) has no linked `member_id`, so `/members/impact` always renders its "Account Not Linked" empty state for this account, regardless of giving totals | Substituted with the SQL ground-truth check above (which independently reproduces `getPhilanthropy`'s filter) plus the code-level proof that `getCategoryImpact`'s query is structurally identical to `getPhilanthropy`'s own WHERE clause (already unit-tested by api-developer via `PgDialect().sqlToQuery()` structural comparison, Phase 3 test 9). Flagging for the user: if a true pixel-for-pixel `/members/impact` before/after check is wanted, it needs an e2e fixture user linked to a member record — currently no such fixture exists in this project. |

### Regression Tests Added

- `e2e/ledger-category-management.spec.ts` — 13 tests, all new (this feature had no prior e2e coverage):
  - `impact counts for a multi-fiscal-year category match independently-computed SQL ground truth` — guards against: the rename-impact preview ever silently drifting from the true transaction/budget-line counts, which Treasurer Decision 1 requires the treasurer be able to trust before consenting to a rename.
  - `merge's transaction-count refusal cites the exact same total the impact endpoint reports` — guards against: the two counts (merge refusal, impact preview) ever showing different numbers for the same fact, which the QA brief explicitly calls a FAIL condition.
  - `impact endpoint's postedGivingCents matches independently-computed SQL ground truth` — guards against: `getCategoryImpact`'s giving filter drifting from `getPhilanthropy`'s filter over time (e.g. a future edit to one query without the other).
  - `flipping countsAsGiving on then off via the real UI persists the change...` — guards against: the retroactive-giving-flip's confirm dialog or PATCH silently no-op'ing or mis-persisting.
  - `renaming a category with no locked years is a plain save (no ConfirmDialog)` — guards against: an unnecessary confirm gate appearing where Treasurer Decision 1 says a plain save is correct.
  - `renaming a category with a locked fiscal year shows the locked chip, gates behind ConfirmDialog, relabels history, and writes a readable audit diff` — guards against: a locked year silently blocking rename (violates Treasurer Decision 1) or silently skipping disclosure.
  - `refuses when both source and destination have a budget row in the same fiscal year` / `refuses to merge into an inactive destination...` / `refuses when the current fiscal year is locked` — guard against: any of merge's three refusal paths regressing to a silent 200 or a wrongly-worded error.
  - `re-points the budget row in one transaction, leaves transactions untouched, and is fully reversible` — guards against: a successful merge ever touching `ledger_transactions` (the one hard invariant Treasurer Decision 2 sets for merge).
  - `deactivate with no open balance` / `deactivate with an open, non-locked current-FY budget row warns but still succeeds; reactivate recovers it` — guards against: deactivate ever becoming a hard block (violates DECISION-066 item 4) or reactivate ever failing to recover a mis-click.
  - `unauthenticated visitor is redirected away from the categories settings page` — guards against: the page gate regressing.

### Coverage on Critical Modules

(Scoped `vitest run --coverage` against the three modules this feature added/changed; ledger.ts's figure is for the whole file, most of which predates this feature.)

- `src/lib/ledger-category-queries.ts`: **88.07% statements / 80.85% branch** — uncovered lines are mostly defensive `?? 0` fallbacks and one unreachable error-shape branch; the merge/impact/update happy and refusal paths are all covered (24 unit tests + this suite's live exercise of every path).
- `src/lib/ledger-category-ui.ts`: **100% statements / 96.96% branch**.
- `src/lib/ledger.ts` (includes the new `validateCategoryEditInput`/length-cap additions): **100% statements / 96.35% branch**.
- Both meet or exceed this project's 80%+ target for `src/lib/members.ts`-class modules; `ledger-category-ui.ts` and the new validator additions clear the 90%+ bar this file's own coverage targets set for `events.ts`-class deterministic modules.

### Feature-Gate Audit (mandatory before PASS)

Read every route and the page directly — not inferred from passing tests.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /api/admin/ledger/categories` | yes | yes, before any DB access | `FEATURES.LEDGER_MANAGE` |
| `POST /api/admin/ledger/categories` (pre-existing, unchanged) | yes | yes | `FEATURES.LEDGER_MANAGE` |
| `PATCH /api/admin/ledger/categories/[id]` | yes | yes, before the 404 lookup | `FEATURES.LEDGER_MANAGE` |
| `GET /api/admin/ledger/categories/[id]/impact` | yes | yes | `FEATURES.LEDGER_MANAGE` |
| `POST /api/admin/ledger/categories/merge` | yes | yes, before any body validation | `FEATURES.LEDGER_MANAGE` |
| `src/app/(dashboard)/admin/ledger/settings/categories/page.tsx` | yes (`auth()`, redirects to `/signin` if absent) | yes (`hasFeature(LEDGER_MANAGE)`, redirects to `/admin/ledger` if absent) — **runs before `getEntities()`/`getFunds()`/`listCategoriesForAdmin()`, confirmed by reading the function body in order** | `FEATURES.LEDGER_MANAGE` |

`LEDGER_MANAGE` is the correct key here: every operation this feature exposes is a mutation or a preview-of-a-mutation against the club's live books (rename, merge, deactivate/reactivate, flag edits), and `LEDGER_MANAGE` is the existing, already-Admin-bound key that gates every other Ledger mutation surface in this app (Treasurer Decision 5, reaffirmed by DECISION-065/066) — there is no bulk-PII-without-mutation read path here that would call for a narrower `*_VIEW` key instead.

### Verdict: PASS

### Open questions / handoff notes

- Nominating **analyst** for Phase 6 (shipped-vs-intent).
- One functional gap worth analyst's attention at Phase 6, not a QA blocker: `/members/impact` cannot be cross-checked end-to-end for `countsAsGiving` because no e2e fixture user is linked to a member record. If the club wants a true visual/dollar-figure cross-check as ongoing regression coverage (rather than the code-level equivalence proof this pass relied on), a linked e2e member fixture would need to be seeded first — that's a `docs/backlog.md`-worthy follow-up, not something to block this feature's ship on.
- One disposable leftover in the dev DB: category `QA E2E Open Balance <timestamp>` (Club, Activity Fund, expense), left inactive with a `pendingDelete` FY2026 budget row — created and intentionally left behind by the new e2e suite's "deactivate with open balance" test (see Outputs). Harmless and matches this dev DB's existing pattern of small e2e leftovers; flagging so nobody mistakes it for a real category on a future audit.
- `e2e/ledger-category-management.spec.ts` is a new permanent file — not yet committed (no commit was made, per the standing "do not commit without approval" rule). The next agent or the user should `git add`/commit it alongside the feature's other Phase 4 files when the user is ready to commit.

---

# Phase 6 — Shipped vs Intent (analyst)

**Owner:** analyst
**Status:** complete

### Summary

The shipped feature delivers the rename operation exactly as the treasurer needs it, delivers
deactivate/reactivate/flags-editing cleanly, and gives merge a correctly-scoped, honestly-refused
zero-transaction-only guardrail. Read against the actual code (not the write-ups), two things
don't fully match what Phase 1/Treasurer Decision 3 promised: merge silently re-points *every*
fiscal year the source category has ever touched — including locked, board-approved prior years —
which is broader than what either precedent script ever did or than the script author's own stated
reasoning would have allowed; and the new `ledger_audit_log` table, while well-shaped and populated
correctly, has no viewer anywhere in the app, so "who changed what, when" (Treasurer Decision 3's
whole point) is still only answerable by raw SQL — the exact workflow this feature exists to retire.
Neither is a correctness bug and neither blocks shipping what's here today; both are concrete,
scoped follow-ups.

### What I did

- Read the full work-log (Phase 1 review, Treasurer Decisions, Phase 2 architect verdict, Phase 3
  design doc and API contracts, all three Phase 4 implementation sections, Phase 5 QA report) and
  DECISION-065/DECISION-066 in full.
- Read the shipped code directly rather than trusting the write-ups: `src/lib/ledger-category-queries.ts`,
  `src/lib/ledger-category-ui.ts`, all four route files under `src/app/api/admin/ledger/categories/**`,
  `category-list.tsx`, `ledgerAuditLog` in `schema.ts`, `drizzle/migrations/0074_ledger_category_audit.sql`,
  and `e2e/ledger-category-management.spec.ts`.
- Re-read both precedent scripts (`scripts/apply-fy2026-budget-review.ts`, `scripts/merge-club-budget-categories.ts`)
  line by line and traced what the shipped `mergeCategories()` would actually do if asked to replay
  the real Awards→Member recognition / Supplies→Program supplies merges today.
- Confirmed today's fiscal year (2026-08-07 → `currentFiscalYear` = FY2026) is the same FY both
  scripts operated on, so the replay comparison is apples-to-apples, not hypothetical.
- Grepped the codebase for any UI consumer of `ledgerAuditLog`/`permissionAuditLog`/
  `googleGroupSyncLog`/`failedLoginAttempts` to establish whether "write an audit table, no viewer"
  is this codebase's actual norm or a gap specific to this feature.

### Outputs

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The treasurer can now rename, deactivate/reactivate, and edit flags on a live category entirely
> through the UI with a trustworthy impact preview and a real audit trail — but merge quietly reaches
> further into locked prior-year history than either real-world precedent ever did, and that new audit
> trail has no screen anywhere in the app to actually read it from.

## What's Working

- **Rename is the single most important flow here, and it's right.** `PATCH /api/admin/ledger/categories/[id]`
  has no lock check on `name` at all (matches Treasurer Decision 1 exactly), and
  `category-rename-dialog.tsx` fetches `GET .../impact` before any save is possible, showing every
  fiscal year the category touches with an amber "locked" chip on the ones that are closed — QA
  exercised this against a real locked Foundation FY2025 and confirmed the disclosure-then-confirm
  sequence, then confirmed the relabel actually took. This is the exact "Bags to Benches" scenario
  from the evidence, now doable by a human clicking a button instead of a treasurer running a
  hand-verified `tsx` script.
- **The impact endpoint generalizes, it isn't a lucky single case.** `getCategoryImpact()`'s
  transaction count is an unconditional `count()` with no special-casing, and its
  `postedGivingCents` figure was proven — not just spot-checked — structurally identical to
  `getPhilanthropy()`'s own WHERE clause via `PgDialect().sqlToQuery()` param comparison (Phase 3
  test 9), on top of QA's independent SQL ground-truth check on a real 39-transaction, 5-fiscal-year
  category. A treasurer approving a rename based on these counts has a genuinely trustworthy number,
  not a number that happened to be right once.
- **Deactivate/reactivate closes a real gap the request never mentioned.** Phase 1 flagged that
  nothing in the app had ever set `isActive = false`, and that a first-ever "remove" capability needs
  a symmetric "undo." `PATCH { isActive: true }` on the same general-purpose endpoint means
  reactivation cost nothing extra to build, and `category-list.tsx` renders inactive rows visibly
  muted with a one-click Reactivate action — a mis-click is now a 5-second fix instead of a
  support-engineer SQL request.
- **Brand and gating hold up.** Every card is `rounded-2xl`, every button `rounded-lg`, every
  destructive/retroactive action (deactivate, merge, the `countsAsGiving` flip) routes through
  `<ConfirmDialog>` — confirmed by grep (zero `window.confirm|alert|prompt` matches) and by reading
  every dialog component directly, not by trusting the grep alone. All four routes and the page check
  `auth()` then `hasFeature(LEDGER_MANAGE)` before touching the database, in that order, read
  directly rather than inferred from passing tests.

## Intent-vs-Shipped Diff

- **Phase 1 said:** rename must show what it affects (transactions, budget lines, which fiscal years)
  before an admin can commit to relabeling a locked year. **Shipped:** exactly that, via the shared
  impact endpoint. **Verdict: matches.**
- **Treasurer Decision 2 said:** merge in v1 refuses whenever the source has *any* transactions, matching
  what `merge-club-budget-categories.ts` actually did. **Shipped:** exactly that refusal, with the exact
  count in the message. **Verdict: matches.**
- **Treasurer Decision 2 / DECISION-066 said** ("Merge's lock check stays scoped to the current fiscal
  year only... matching both precedent scripts exactly" — DECISION-066 item 3) that re-pointing a
  locked prior year with a source-only budget row "matches both precedent scripts exactly." **Shipped:**
  `mergeCategories()` fetches every `ledger_budgets` row for the source with no fiscal-year filter at
  all (`ledger-category-queries.ts:529-548`) and re-points every non-colliding year on `confirm: true`
  — current, prior, locked or not, annotated but never blocked. **This does not actually match either
  precedent script.** `merge-club-budget-categories.ts` is hardcoded to `FY = 2026` throughout — every
  query and every `UPDATE` is scoped `WHERE fiscal_year = ${FY}` — and its own header comment states
  the FY2025 Awards/Supplies rows were "DELIBERATELY NOT TOUCHED... rewriting an approved prior-year
  budget to match this year's naming would falsify the historical record." That is a materially
  different judgment than "disclose the locked year and let it move." Replaying the real Awards→Member
  recognition merge through the shipped UI today (FY2026 is still the current fiscal year, so this
  isn't hypothetical) would move both Awards' FY2026 row *and* its FY2025 row to Member recognition —
  something the script's own author explicitly declined to do for this exact category. **Verdict:
  regression against the actual precedent**, even though it is a faithful implementation of what the
  Phase 3 design doc and DECISION-066 *said* the precedent was. The design doc's rationale is the thing
  that's wrong, not an unreviewed implementation choice — see Follow-Ups.
- **Treasurer Decision 3 said:** category changes are audited — "who changed what, when" — because
  these are destructive edits to live financial books that may end up in front of the board or the
  IRS. **Shipped:** a well-shaped `ledger_audit_log` table, written correctly and readably on every
  rename/merge/deactivate/reactivate/flags call (QA read real rows and confirmed clean before/after
  diffs and human-readable merge `details`). **But there is no UI anywhere in the app that reads this
  table** — not on the category row, not a history panel, not a dedicated page. Grepping the codebase
  confirms `googleGroupSyncLog` has `/admin/sync-log` and `failedLoginAttempts` has `/admin/security`,
  so this codebase's actual norm is to pair an audit-shaped table with an admin viewer two times out of
  three (the exception, `permissionAuditLog`, also has no viewer — this feature followed that one
  exception rather than the majority pattern). **Verdict: acceptable drift, but the promise isn't fully
  delivered** — the data exists and is trustworthy; a treasurer six months from now still can't get to
  it without asking someone to run SQL, which is exactly the workflow Treasurer Decision 3 was meant to
  retire.
- **Treasurer Decision 4 said:** hard delete is off the table; `isActive = false` is the only safe
  removal path. **Shipped:** no delete route or button exists anywhere in this feature.
  **Verdict: matches.**
- **The "Supplies → Program supplies" merge also raised the destination's budgeted amount** ($75 →
  $700) in the same operation, per the script's own header. **Shipped merge only ever re-points
  `category_id`** — it has no amount field. **Verdict: acceptable drift** (amount edits correctly stay
  the Budget Editor's job, not merge's), but worth naming so nobody expects merge alone to fully
  replicate that specific historical operation — a manual budget-amount edit is still a required
  second step.

## Edge Cases

- Empty state: **pass** — "No categories yet for {entity}" (with a Create prompt) and "No categories
  match your filters" (with Clear filters) both render `bg-gray-50 rounded-2xl p-10 text-center
  text-gray-500`, per CLAUDE.md, confirmed by reading `category-list.tsx` directly.
- Failure microcopy: **pass** — every 409/400 message is specific and actionable ("This category has 3
  transactions — merging categories with transaction history isn't supported yet.", "Both 'Awards' and
  'Member recognition' have FY2026 budget rows — resolve by hand.", "Cannot merge into 'X' — it is
  deactivated. Reactivate it first."); network/DB failures surface as toasts, not stack traces.
- Permission gate: **pass** — verified by QA's Feature-Gate Audit (code read, not test-inferred) across
  all four routes and the page; confirmed independently by reading the same four route files myself.
- Mobile (360px): **pass by code inspection, not independently verified at a real 360px viewport** —
  the accordion (`<details>`), entity tabs, `overflow-x-auto` tables, and `min-h-[44px]` touch targets
  are all present in `category-list.tsx`, but neither QA's Phase 5 report nor
  `e2e/ledger-category-management.spec.ts` sets a mobile viewport or records an actual narrow-width
  check — ux-developer's own handoff checklist asked qa to do this and it doesn't appear in QA's
  Manual Click-Through table. Low risk given the code, but not the same thing as verified.

## Follow-Ups (if SHIP WITH NOTES)

1. **Reconcile merge's cross-fiscal-year scope with what the precedent actually supports.** Either (a)
   get explicit treasurer sign-off that merge re-pointing a locked prior year's budget row — disclosed
   via a "locked" chip but never blocked — is genuinely wanted going forward (in which case correct
   DECISION-066 item 3's "matches both precedent scripts exactly" claim, since it currently doesn't),
   or (b) scope `mergeCategories()`'s re-pointing to unlocked fiscal years by default, matching what
   `merge-club-budget-categories.ts` actually did and its stated "would falsify the historical record"
   reasoning, with a locked-year re-point requiring a separate, more explicit action if ever needed.
   This is the one place shipped behavior is materially more permissive against live financial history
   than any real precedent this feature was built from.
2. **Build a minimal `ledger_audit_log` viewer.** Even a simple "History" expansion on a category row,
   or a `GET`-only `/admin/ledger/settings/categories/history` page listing recent rows (actor, action,
   before/after, details, timestamp) would make Treasurer Decision 3's actual promise deliverable
   without SQL — matching this codebase's own majority pattern (`/admin/sync-log`, `/admin/security`)
   for audit-shaped tables. The data is already clean and correctly written; this is a pure
   read-surface gap.
3. **Seed an e2e admin fixture linked to a member record** (already flagged by QA) so a future
   `countsAsGiving` regression test can visually cross-check `/members/impact`'s rendered totals, not
   just the code-level equivalence proof this pass relied on.
4. **Verify the mobile layout at an actual 360px viewport** — either a quick manual pass or a
   `page.setViewportSize({width: 360, height: 640})` addition to the existing e2e spec — since this was
   asked for in the ux-developer handoff and QA's report doesn't show it was exercised.
5. **Note in the merge dialog's copy (or the treasurer-facing docs) that merge does not adjust the
   destination's budgeted amount** — the real "Supplies → Program supplies" operation this feature is
   modeled on also raised the destination's budget by $625 in the same step; that still requires a
   separate Budget Editor edit after merging.

## Red Flags (if NEEDS REWORK)

None. Nothing here requires reopening Phase 3/4 — the merge cross-year scope and the missing audit
viewer are both real, but both are additive, disclosed-not-silent gaps against a feature that
otherwise delivers exactly what was asked for, tested at real scale against real dev-DB data.


---

## Treasurer Decisions (2026-08-07)

1. **Rename is allowed even when a locked year references the category — but the UI must first show
   what it affects**: a count of transactions and budget lines, and which fiscal years will relabel.
   Rationale: a category name is a label, not a figure. The `Program supplies` → `Bags to Benches`
   rename deliberately relabelled a locked FY2025 line and that was the *correct* outcome — all six
   transactions ever posted to it were benches, and the budget committee could not find the benches
   budget precisely because of the old name. Refusing on locked years would have blocked the fix.
2. **Merge in v1 refuses whenever the source category has ANY transactions.** This matches exactly what
   `scripts/merge-club-budget-categories.ts` actually did — both real merges had zero-transaction
   sources, and the script only ever re-pointed `ledger_budgets.category_id`, never
   `ledger_transactions`. A general merge that rewrites transaction history in bulk is a materially
   bigger, unproven feature; it is explicitly deferred, and the refusal must state the reason and the
   transaction count rather than failing opaquely.
3. **Category changes are audited.** Who changed what, when, for renames, merges, deactivations, and
   flag changes (`countsAsGiving`, `form990Line`, `isActive`). No audit trail exists for ledger writes
   today — `ledgerCategories` has no actor column and none of the three audit-log-shaped tables
   (`permissionAuditLog`, `googleGroupSyncLog`, `failedLoginAttempts`) cover it. These are destructive
   edits to the club's live books, and this feature moves the capability from a script only the
   coordinator could run to a button in Settings, which raises the value of a record considerably.
4. Settled by inspection, not preference: **hard delete is off the table.** Both
   `ledger_transactions.category_id` and `ledger_budgets.category_id` are `ON DELETE SET NULL`, so
   deleting a category would silently blank the category reference on live financial history.
   `isActive = false` is the only safe removal path.
5. Permission: **`FEATURES.LEDGER_MANAGE`**, which already exists and is Admin-bound. No new key.

---

## Phase 6 Re-Check (loop-back) — 2026-08-07

**Owner:** analyst
**Status:** complete

### Summary

Note 1 is closed **as coded**: `mergeCategories()` now has a single refusal step (step 8, after the
both-sides-collision check, before the plan is returned) that fires identically for `confirm:false`
and `confirm:true`, refuses the *whole* merge rather than skipping the locked year, and names the
year(s). Read directly in `src/lib/ledger-category-queries.ts:594-615` — matches DECISION-067
exactly. `category-merge-dialog.tsx` explains the block in plain language; DECISION-066 item 3 is
struck through in place with a dated cross-reference to DECISION-067, not silently edited. Gates
(coordinator-verified, not a full qa pass): `tsc` clean, 1059/1059 unit tests, `pnpm build:only`
clean.

But tracing the judge's question 2 concretely against the live dev DB surfaced something the
loop-back didn't anticipate, and it's the more important finding here: **the whole-merge refusal is
keyed to `ledger_budget_approvals.status = 'locked'`, not to "is this a past/closed fiscal year,"
and right now zero fiscal years for any entity are actually locked in this database** — every
`ledger_budget_approvals` row present is a QA e2e artifact (`SELECT count(*) ... WHERE status =
'locked'` → **0**). Club FY2025 — the exact year `Awards`/`Supplies` still carry a budget row in,
and the exact year `merge-club-budget-categories.ts` deliberately hardcoded its scope to avoid
touching — has **no** approval row at all, so it reads `locked: false` by the documented "no row =
unlocked by default" convention.

Tracing the real merge concretely: `Awards` (Club, Administrative, expense) currently has exactly
one budget row — FY2025, $200, confirmed 0 transactions. `Member recognition` has no budget rows.
Running Awards → Member recognition through the shipped UI today: same scope (pass), destination
active (pass), current-FY-2026 lock check (pass, unlocked), source transaction count 0 (pass), no
both-sides collision (destination has no rows) (pass), plan = `[{fiscalYear: 2025, locked: false}]`
— **step 8 finds no locked years and the merge proceeds**, re-pointing the FY2025 row to `Member
recognition`. `Supplies` (also FY2025-only, $75, 0 transactions) traces identically against
`Program supplies`.

### Judge Answers

1. **Is the first note genuinely closed?** Partially. The *code path* Phase 6 flagged — "disclosed
   via a `locked: true` chip but never blocked" — no longer exists; that specific gap is closed.
   But the underlying harm Phase 6 was actually worried about — merge silently re-pointing an
   approved prior-year budget row — is **not** closed for `Awards`/`Supplies` in their current real
   state, because the fix's trigger (`status = 'locked'`) has never been set for Club FY2025. The
   fix is a correct implementation of DECISION-067's literal text; it does not restore the
   precedent script's actual boundary (which was FY-scope, not lock-status).
2. **Does the whole-merge refusal leave the treasurer able to do the real work?** Yes — traced
   concretely above, both real merges (`Awards`→`Member recognition`, `Supplies`→`Program supplies`)
   succeed through the UI as of right now. So there is **no over-correction** — the judge's
   hypothesized failure mode (fix blocks legitimate work) didn't materialize. The actual failure
   mode found is the opposite and, per the judge's own framing ("if the answer is no... that matters
   more than the original gap"), arguably matters just as much: the merge succeeds by quietly moving
   the FY2025 row, which is precisely what the treasurer's own script refused to do and what
   DECISION-067 was written to prevent — it just isn't caught, because nothing in the system has
   ever locked Club FY2025. **Recommend before either merge is run for real: lock Club FY2025 (and
   any other genuinely closed fiscal year that still carries a source-category budget row) via
   Approve & Lock first** — that alone makes the shipped refusal fire correctly, no code change
   needed. Longer-term, the tech-lead should consider whether `mergeCategories()`'s plan should be
   scoped to the *current* fiscal year only (matching what `merge-club-budget-categories.ts`
   literally did), rather than "all fiscal years the source has ever touched, refuse if any is
   locked" — the current shape's safety depends entirely on a manual, easy-to-skip lock action for
   every historical year a category has ever had a budget line in.
3. **Second note (no audit-log viewer) — stands, confirmed still open.** Grepped the app for any
   consumer of `ledgerAuditLog` — none exists (`/admin/ledger/settings/categories` has no history
   panel, no `/admin/ledger/settings/categories/history` route). Restated as a concrete next work
   item: build a minimal read-only viewer (category-row "History" expansion, or a
   `/admin/ledger/settings/categories/history` list page showing actor/action/before/after/details/
   timestamp) so "who changed what, when" is answerable without SQL — matching this codebase's own
   majority pattern (`/admin/sync-log`, `/admin/security`).
4. **Anything the loop-back broke or left inconsistent?** No regressions found — the existing
   merge-success and other-refusal paths are unchanged and still covered by the loop-back's own
   passing test suite (1059/1059). Follow-up #5 from the original Phase 6 ("merge doesn't adjust the
   destination's budgeted amount") is correctly still open and untouched by this loop-back, as its
   own handoff notes said.

### Verdict

**SHIP WITH NOTES** (not a full re-open — the code faithfully and correctly implements DECISION-067
as written, gates are green, and no real work is blocked). Follow-ups, in priority order:

1. **(New, higher priority than the audit-log gap)** Before running the `Awards`→`Member
   recognition` / `Supplies`→`Program supplies` merges through the new UI, lock Club FY2025 (and
   audit whether any other entity/fiscal-year with a live source-category budget row should also be
   locked) via the existing Approve & Lock flow — otherwise the merge will succeed by silently
   re-pointing that unlocked-but-approved prior-year row, which is the exact outcome DECISION-067
   exists to prevent. Consider filing this as a `T-nn` item in `docs/treasurer-todo.md` since it's an
   operational prerequisite, not just a code follow-up.
2. Have tech-lead reconsider scoping `mergeCategories()`'s re-pointing to the current fiscal year
   only (matching the precedent script's literal behavior), which would close the gap in #1
   structurally instead of relying on the treasurer to lock every historical year by hand.
3. Build a minimal `ledger_audit_log` viewer (original Phase 6 follow-up #2 — still open).
4. Note in the merge dialog copy that merge does not adjust the destination's budgeted amount
   (original Phase 6 follow-up #5 — still open, untouched by this loop-back).

---

## Phase 4 — Implementation (merge prior-FY-block, 2nd loop-back) — 2026-08-08

**Owner:** full-stack-developer
**Status:** complete

### Summary

**Second Phase 6 → Phase 4 loop-back**, scoped to `mergeCategories()` only. The analyst's Phase 6
re-check (above, "Phase 6 Re-Check (loop-back)") found that the 2026-08-07 lock-based whole-merge
refusal (DECISION-067) is a correct implementation of what it says but is vacuous in practice: no
fiscal year has ever actually been locked in this database, so the real `Awards`→`Member
recognition` / `Supplies`→`Program supplies` merges — each category now holding only a leftover
FY2025 budget row — would still succeed by silently re-pointing an approved prior-year row, exactly
what DECISION-067 was written to prevent. The treasurer's follow-up decision: merge must refuse the
whole operation whenever any affected fiscal year is EARLIER than the current fiscal year,
regardless of lock status — both checks apply, and the new one is checked first since it doesn't
depend on locking discipline nobody has practised. Implemented the check, the refusal messaging
(distinguishable wording from the locked-year refusal), non-alarming dialog copy for the specific
"nothing left to merge in the current FY" case (so a treasurer reads `Awards` refusing as intended
behavior, not a bug), the DECISION-068 decision-log entry (with DECISION-067's closing claim
corrected in place, struck through), and unit + e2e coverage using real fixtures.

### What I did

- Read the "Phase 6 Re-Check (loop-back)" section of this work-log, DECISION-066/067, and
  `src/lib/fiscal-year.ts` before touching any code. Confirmed the Phase 6 re-check's DB finding
  independently via read-only SQL against the dev DB (never `PROD_DATABASE_URL`): zero
  `ledger_budget_approvals` rows have `status = 'locked'`; `Awards`/`Supplies`-equivalent scenario
  (`Contingency`, Foundation) carries exactly one real budget row, FY2025, unlocked.
- **`src/lib/ledger-category-queries.ts`** (`mergeCategories()`): added a new refusal step 8,
  inserted immediately after the both-sides-budget-collision check (step 7) and BEFORE the
  existing locked-year check (renumbered 8 → 9) — filters the already-computed `plan[]` for any
  entry with `fiscalYear < currentFY` (`currentFY` reuses the same `currentFiscalYear(new Date())`
  call already made at step 5 for the current-FY-lock check — no second `Date()` call, no
  hardcoded year) and, if any exist, refuses the entire call (identically for `confirm:false` and
  `confirm:true`, since both run the same code path through this point) with a message naming
  every prior year (correct singular/plural grammar: "FY2025 is a prior fiscal year" /
  "FY2024, FY2025 are prior fiscal years") and explaining why in wording deliberately distinct from
  the locked-year refusal ("already closed... regardless of whether it was ever formally locked...
  has nothing left to merge for the current fiscal year"). Checking this new step BEFORE the
  locked-year check means a year that is both prior and locked reports the prior-year reason (it
  doesn't depend on lock status, so it's the more fundamental fact); the locked-year check therefore
  now only ever fires in practice for the current fiscal year or a future one. Updated the module's
  top-of-file doc comment and the function's doc comment to describe the new rule and cross-reference
  DECISION-068.
- **`src/app/api/admin/ledger/categories/merge/route.ts`**: updated the doc comment's refusal-order
  list to insert the new step 8 and renumber the locked-year step to 9 (thin pass-through route, no
  behavior change needed — `mergeCategories()` already returns the right status/error shape the
  route forwards verbatim).
- **`src/lib/ledger-category-ui.ts`**: added a new pure helper, `isPriorFiscalYearMergeRefusal()`,
  matching on two stable phrases the server message always contains ("prior fiscal year" / "already
  closed") rather than duplicating the fiscal-year math client-side. Unit-tested in
  `ledger-category-ui.test.ts` (recognizes the prior-FY message; does not match the locked-year,
  transaction-count, or both-sides-collision messages).
- **`src/components/admin/ledger/category-merge-dialog.tsx`**: updated the top doc comment and the
  `Dialog.Description` copy to explain the new rule plainly (merge only ever touches the current
  fiscal year's budget line; a category whose only remaining row is from a closed prior year has
  nothing left to merge, and that row stays exactly as the board approved it). Added a dedicated,
  non-alarming presentation for this specific refusal — "Nothing to merge in the current fiscal
  year" heading over the server's message, using `isPriorFiscalYearMergeRefusal()` to distinguish it
  from the generic red "failed" treatment every other refusal still gets — this is the concrete fix
  for the loop-back brief's flagged UX consequence: `Awards` now refusing to merge is the correct
  outcome, but a bare red refusal would read as a bug.
- **`docs/decisions.md`**: added **DECISION-068**, which documents the Phase 6 re-check's finding
  (the lock-based guard is a correct reading of DECISION-067 but doesn't restore the precedent
  script's actual fiscal-year-scoped boundary), records the treasurer's 2026-08-08 decision and its
  rationale, and lists the full impact. Corrected DECISION-067's `Status` line and struck through
  (not deleted) the closing sentence of item 2 that claimed the lock-based guard was "the one place
  merge now hard-blocks... beyond the current fiscal year," with an inline note cross-referencing
  DECISION-068 — per the same "do not rewrite history dishonestly" discipline the first loop-back
  used correcting DECISION-066.
- **Unit tests** (`src/lib/ledger-category-queries.test.ts`):
  - Fixed the three existing locked-year tests (FY2024/2025 → FY2027/2028) and the "test 7"
    plan/apply-agreement test (FY2024/2026 → FY2026/2027) so each continues to isolate the specific
    condition its name says it tests — otherwise the new prior-FY check would now also fire for
    those fixtures for an unrelated reason, false-negating what each test is actually checking.
  - Added: refuses the whole merge when an affected fiscal year is earlier than the current FY,
    naming it, even when NOT locked (the real `Awards`/`Supplies` scenario) — both `confirm:false`
    and `confirm:true`, with no writes.
  - Added: names every prior fiscal year with correct plural grammar when more than one applies.
  - Added: when a year is BOTH prior and locked, the prior-fiscal-year message wins (proves the
    new check runs first, per the doc comment).
  - Added: a merge confined to the current fiscal year only (not prior, not locked) still succeeds,
    with the expected plan shape — matching the loop-back brief's explicit regression requirement.
  - Updated the file's top-of-file doc comment to describe DECISION-068 coverage and the fixture
    changes.
- **e2e** (`e2e/ledger-category-management.spec.ts`): added one new test inside the existing
  `merge refusals` describe block using real, already-seeded dev-DB fixtures — `Contingency`
  (Foundation, 0 transactions, real FY2025 budget row) merging toward `Disaster relief` (same scope,
  zero budget rows, so there's no both-sides collision masking the check) — confirms both
  `confirm:false` and `confirm:true` refuse, naming FY2025 and using the prior-fiscal-year wording,
  and that the source still holds its unlocked FY2025 row afterward. Confirmed the fixture via
  read-only SQL against the dev DB before writing the test (`DISASTER_RELIEF_FOUNDATION` had zero
  budget rows and zero transactions as of 2026-08-08). Updated the file's top doc comment to
  describe the new coverage. Started a real local dev server against `DATABASE_URL` (never
  `PROD_DATABASE_URL`) and ran the whole spec file: **15/15 passed**, including the new test in
  isolation and again as part of the full 15-test run — confirmed via read-only SQL afterward that
  `Contingency` still holds its FY2025/$500 row and `Disaster relief` still has zero budget rows
  (the refusal path never writes, as expected). Stopped the dev server and deleted
  `test-results/`/`playwright-report/` afterward.
- Ran `pnpm exec tsc --noEmit` — clean.
- Ran `pnpm test` — **1067 passed** (1059 baseline + 8 new unit tests: 5 in
  `ledger-category-queries.test.ts`, 3 in `ledger-category-ui.test.ts`), 0 regressions, 49 test files.
- Ran `pnpm build:only` — production build passed clean (all existing routes present, including the
  four category-management routes; no new route added in this loop-back).
- Ran `pnpm lint` — pre-existing environment failure unrelated to this change (`ESLint: 9.39.2`
  crashes with `SyntaxError: The requested module 'minimatch' does not provide an export named
  'default'` while loading `@eslint/eslintrc`'s `override-tester.js` — a module-resolution problem
  in the toolchain itself, not in any file this loop-back touched). Not one of the three gates this
  loop-back brief asked for (tsc / test / build:only, all green); flagging for deployment-engineer's
  radar rather than silently ignoring it.
- Ran the full `e2e/ledger-category-management.spec.ts` file against a real local dev server
  (`DATABASE_URL`, never `PROD_DATABASE_URL`) — **15/15 passed**, confirmed no dev-DB mutation from
  the new test via read-only SQL, then stopped the server and deleted `test-results/`/
  `playwright-report/`. Not one of the three requested gates, but run anyway for confidence beyond
  "trust my say-so" before handing off to qa.

### Outputs

- **Modified:** `src/lib/ledger-category-queries.ts` (`mergeCategories()` new refusal step 8,
  renumbered old step 8 → 9, doc-comment updates), `src/app/api/admin/ledger/categories/merge/route.ts`
  (doc comment only), `src/lib/ledger-category-ui.ts` (new `isPriorFiscalYearMergeRefusal()` helper),
  `src/components/admin/ledger/category-merge-dialog.tsx` (doc comment, `Dialog.Description` copy,
  new non-alarming refusal presentation), `docs/decisions.md` (new **DECISION-068**; DECISION-067's
  `Status` line and item 2 corrected in place, struck through with an inline note — not silently
  rewritten).
- **Tests:** `src/lib/ledger-category-queries.test.ts` (3 existing tests' fixtures corrected + 5 new
  tests; top doc comment updated); `src/lib/ledger-category-ui.test.ts` (3 new tests for
  `isPriorFiscalYearMergeRefusal`); `e2e/ledger-category-management.spec.ts` (1 new test in the
  `merge refusals` describe block; top doc comment updated).
- **No schema change.** No new endpoint, no new `FEATURES` key.
- **Decision logged:** DECISION-068 (`docs/decisions.md`), correcting DECISION-067's closing claim
  in place and recording the treasurer's 2026-08-08 decision (whole-merge refusal on any prior
  affected fiscal year, regardless of lock status, checked before the existing lock check).
- **Gates:** `pnpm exec tsc --noEmit` — clean. `pnpm test` — 1067 passed (0 regressions from the
  1059 baseline this loop-back started with). `pnpm build:only` — passed. `pnpm lint` — pre-existing
  environment failure, unrelated to this change (see above), not one of the requested gates. Full
  e2e spec file (not a requested gate, run anyway) — 15/15 passed against a real local dev server.

### Open questions / handoff notes

- **Phase 5 needs a re-verify scoped to merge**, not a full re-run of the whole feature: confirm
  (a) the new prior-fiscal-year whole-merge refusal fires correctly against real data — the new
  e2e test (`Contingency` → `Disaster relief`) exercises this and passed 15/15 with the rest of the
  file in this session, but qa should re-run it independently rather than trust it on my say-so,
  (b) the existing merge-success and other-refusal e2e tests still pass unchanged (their fixtures — FY2099
  for the locked-non-current-year test, FY2026 for current-FY-locked — were deliberately untouched
  by this loop-back since they were already future/current years, not prior ones), (c) the dialog's
  new "Nothing to merge in the current fiscal year" presentation actually renders correctly for a
  real refusal (e.g. previewing a merge FROM `Awards` through the real UI) rather than just the
  unit-tested string-matching logic, and (d) the DECISION-067/068 pairing in `docs/decisions.md`
  reads honestly (original claim visible and struck through, not deleted; correction clearly dated
  and cross-referenced).
- Nominating **qa** for the Phase 5 re-verify, then back to **analyst** for a short Phase 6
  re-check — specifically to confirm the real `Awards`/`Supplies` scenario now behaves as intended
  (refuses, with copy that reads as "nothing to do" rather than "broken") and that no further gap
  remains in the fiscal-year-scoping logic.
- Phase 6's follow-up #1 from the first loop-back ("lock Club FY2025... before running the real
  merges") is now **structurally moot** — the merge is refused regardless of lock status, so there
  is no operational prerequisite to lock FY2025 first. Recommend analyst close that follow-up as
  superseded rather than carrying it forward as a stale action item.
- Phase 6 loop-back follow-up #2 (tech-lead reconsidering whether `mergeCategories()`'s plan should
  be scoped to the current fiscal year only, matching the precedent script's literal behavior) is
  now **effectively resolved** by this change from a different angle: rather than narrowing what the
  plan can ever contain, the plan can still show prior years (for transparency, though one will
  always be refused) and the refusal enforces the same practical boundary. Recommend analyst confirm
  this satisfies the intent of that follow-up rather than requiring a separate tech-lead pass.
- Follow-up #3 from the first loop-back (minimal `ledger_audit_log` viewer) and follow-up #4 (merge
  dialog noting it doesn't adjust the destination's budgeted amount) were **not** addressed in this
  loop-back — both are separate, narrower gaps the loop-back brief didn't ask for. Still open.
- Did not touch `scripts/`, per the hard constraint. Did not commit or push, per the standing rule
  and the explicit hard constraint in this loop-back's brief. Did not run anything against
  `PROD_DATABASE_URL` — all read-only SQL used during investigation ran against `DATABASE_URL`
  (dev) only.

---

## Phase 6 — Final Re-Check (2nd loop-back) — 2026-08-08

**Owner:** analyst
**Status:** complete

### Summary

Read the code directly, not the write-ups: `mergeCategories()` in `src/lib/ledger-category-queries.ts`
(lines 500-700ish), `category-merge-dialog.tsx`, `ledger-category-ui.ts`'s new
`isPriorFiscalYearMergeRefusal()`, DECISION-068 and the corrected DECISION-067, and
`ledger-category-queries.test.ts` in full for every test whose fixture years moved. Everything
matches what the work-log and decision log claim. Gates were verified independently by the
coordinator (typecheck clean, 1067/1067 unit tests, `pnpm build:only` clean, e2e category spec
15/15 against a real dev server) — I did not re-run them, but I did read the specific test bodies
rather than trust the pass count alone.

### Judge Answers

1. **Is the merge boundary now right?** Yes, and it is *stricter* than the precedent script in one
   deliberate, already-decided way worth naming precisely. `mergeCategories()` computes `currentFY`
   from `currentFiscalYear(new Date())` (never hardcoded — confirmed at `ledger-category-queries.ts:546`
   and reused at `:627` for the new check), and step 8 refuses the **whole** merge if any planned
   year is `< currentFY`, before step 9's locked-year check (which now, per its own comment, "only
   ever fires in practice for the current fiscal year or a future one"). The precedent script
   (`merge-club-budget-categories.ts`) achieved the same *outcome* — FY2025 rows never moved — by a
   different mechanism: it was hardcoded to `FY = 2026` and simply never queried or touched other
   years. The new code queries all years and then refuses outright if a prior one shows up, rather
   than silently ignoring it and merging just the current year. That's a **whole-operation refusal**,
   not a **replay of the script's partial scope** — and that distinction is the correct one, not an
   accidental stricter reading: DECISION-067 already established the "whole-merge refusal, not a
   partial merge that skips the bad year and proceeds for the rest" discipline for locks, for
   exactly the reason that a partial merge leaves one category's history split across two names with
   no obvious record of why. DECISION-068 extends the same discipline to prior years rather than
   inventing a new policy. So: does it stop where the precedent script stopped? Not mechanically —
   it stops at a *stricter* boundary the treasurer chose on purpose, for a reason the work-log
   states plainly. That's a good-faith, documented judgment call, not scope creep.
2. **Did moving the test fixture years weaken any test?** No. Read all three moved fixtures plus the
   plan/apply-agreement test directly (`ledger-category-queries.test.ts:423-511` and
   `:578-698`). Each locked-year test now uses FY2027/FY2028 — future, not prior — specifically so
   the lock check fires without the new prior-year check pre-empting it (each test's own inline
   comment says this explicitly, and the top-of-file doc comment records the rationale once for all
   three). The plan/apply-agreement test (formerly FY2024/2026, now FY2026/2027) uses two
   *non-prior, unlocked* years so it's still testing "does `confirm:false`'s plan match
   `confirm:true`'s actual writes," not accidentally exercising either refusal path. A new,
   dedicated test (`:845-875`) confirms ordering directly: a year that is *both* prior and locked
   produces the prior-year message, not the locked-year one — proving step 8 really does run before
   step 9 rather than asserting it only in a comment. Nothing here is a test quietly renamed by
   moving its fixture; every moved fixture still fails for the reason its name says it tests, and a
   new test was added to cover the interaction the move could have hidden.
3. **Is merge still useful?** Split answer, and the honest one matters more than the reassuring one.
   For the **existing Awards/Supplies cleanup, no** — both categories now hold only their FY2025
   remainder (their FY2026 rows were already re-pointed by the original script run before this
   feature existed), so merging either through the UI today refuses outright with "nothing left to
   merge in the current fiscal year," rendered in the dialog's neutral gray "Nothing to merge"
   presentation rather than the generic red failure — confirmed by reading
   `category-merge-dialog.tsx:204-210` directly, not just the unit test for the string-matching
   helper. That specific cleanup is done; merge cannot help finish it further, nor should it — the
   FY2025 rows are exactly what both DECISION-067 and DECISION-068 exist to keep untouched. **For
   future work, yes** — the added test "a merge confined to the current fiscal year still succeeds"
   (`:877-911`) demonstrates the ordinary case: two categories whose only budget history is the
   current fiscal year merge cleanly, with a real plan and real writes. That is the shape most future
   merges will actually take (a treasurer consolidating two categories created or budgeted this year,
   before any of it is locked or closed) — it's only a *closed-out prior year lingering on the
   source* that now blocks, which is precisely the case where blocking is correct. Say this plainly
   to the treasurer: merge works going forward for same-year consolidations; it will not help you
   finish tidying old categories that still carry a prior-year balance — that cleanup, if wanted, is
   a manual `ledger_budgets` edit outside this feature, same as before this feature existed.
4. **No audit-log viewer — still a follow-up, not a blocker.** Confirmed by grep: no route or
   component anywhere reads `ledgerAuditLog` (no `/admin/ledger/settings/categories/history`, no
   history panel on the row). The table is correctly populated (verified in this pass's earlier read
   of `mergeCategories()`'s transaction block, which writes one `ledgerAuditLog` row with
   `action: "category_merged"`, `targetCategoryId: sourceId`, and a human-readable `details` string
   naming the destination and affected years). Nothing about this loop-back touched or needed to
   touch that gap. It remains exactly what both prior Phase 6 passes called it: real, additive,
   non-blocking.

### Verdict

**SHIP IT.**

The merge boundary is now correct and its correctness no longer depends on anyone remembering to
lock a fiscal year — the DECISION-068 fix closes the actual gap the first re-check found, not just
the gap's paperwork. Both guards (prior-FY, locked-year) are in one code path shared by plan and
apply, ordered correctly, tested for that ordering directly, and none of the fixture moves cost any
test its original meaning. The dialog distinguishes "nothing to do here, and that's fine" from a
real failure, so a treasurer hitting the now-more-common prior-FY refusal won't read it as a bug.

Two items remain open, tracked, not blocking:
- Build a minimal `ledger_audit_log` viewer (open since the first Phase 6 pass).
- Note in the merge dialog copy (or treasurer docs) that merge never adjusts the destination's
  budgeted amount (open since the first Phase 6 pass).

Both are additive UI/documentation gaps against a feature whose destructive paths (merge, deactivate,
the `countsAsGiving` flip) are all now correctly guarded, correctly disclosed, and correctly refused
where refusal is the right answer. Pipeline closes.

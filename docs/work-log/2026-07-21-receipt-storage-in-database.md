# Receipt Storage in the Database (replace Vercel Blob) — Work Log

> **Slug:** `2026-07-21-receipt-storage-in-database`
> **Surface:** (dashboard) admin + member — all receipt/letter upload & view routes (via the `getReceiptStorage()` factory)
> **Permission(s):** unchanged (`LEDGER_RECORD`, reimbursement/ack existing gates)
> **Estimated complexity:** medium
> **Pipeline mode:** Full — new table + new storage adapter + factory-selection change (schema is source of truth; DECISION-020 amended)

**Intent (user, 2026-07-21):** A production receipt upload of a real photo failed
with "Failed to upload receipt" (HTTP 500). Root cause: `BLOB_READ_WRITE_TOKEN`
is not set in the production Vercel project, so `getReceiptStorage()` falls back
to `LocalReceiptStorage`, which does `fs.writeFileSync` to `.receipt-store/` on
Vercel's **read-only** function filesystem → throws → 500. This would break ALL
receipt uploads in production, not just HEIC; the user was the first to attempt a
production upload since the receipt features (v1.31+) shipped. The user also
expected receipts to live in the database, not an external blob store, and is on
the Vercel **Hobby** plan (Blob ~250 MB cap + 30-day lockout-if-exceeded risk).

**Decision (user, 2026-07-21):** Store receipt/letter **bytes in Postgres (Neon)**
via a new `DatabaseReceiptStorage` adapter, selected in production instead of
Vercel Blob. Removes the external dependency, the token requirement, and the
Hobby cap; matches the user's mental model; backed up with the rest of the DB.

**Scope:**
- New table holding `(key PK, content_type, bytes bytea, created_at)`.
- New `DatabaseReceiptStorage` implementing the existing `ReceiptStorage`
  interface (`save`/`read`/`delete`) — **no route changes**, since all five
  upload/view/delete surfaces already go through `getReceiptStorage()`:
  ledger transaction upload/view, admin + member reimbursement view, member
  reimbursement upload, and acknowledgment-letter save/read/delete.
- Factory (`getReceiptStorage()`) selects the DB adapter in production.
- `receiptBytesToBodyInit()` byteOffset/pooling regression guard still applies
  to bytes returned from the DB adapter's `read()`.

**Out of scope (user-confirmed):** No data migration — there are **no existing
production receipts** to move (uploads have been failing). `@vercel/blob` and the
Blob/Local adapters: to be decided by architect (keep Local for zero-config unit
tests? remove Blob outright?).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | complete | READY WITH NOTES | 2026-07-21 |
| 2 — Architectural review | architect | complete | Approved with suggestions | 2026-07-21 |
| 3 — Technical design | tech-lead | complete | Design complete | 2026-07-21 |
| 4 — Implementation (schema) | database-admin | complete | — | 2026-07-21 |
| 4 — Implementation (server) | api-developer | complete | — | 2026-07-21 |
| 5 — Verification | qa | complete | PASS | 2026-07-21 |
| 6 — Shipped vs intent | analyst | complete | SHIP WITH NOTES | 2026-07-21 |

---

## Phase 1 — Functional Refinement — 2026-07-21

**Owner:** analyst
**Status:** complete

### Summary

This is a backend adapter swap, not a new feature — zero new UI, zero new user
verbs. The `ReceiptStorage` interface (`save`/`read`/`delete`) already isolates
all six route handlers from the storage backend, so a `DatabaseReceiptStorage`
adapter genuinely can slot in with no route changes, confirmed by reading all
six consumers directly. The scope as written is sound. Five gaps surfaced that
the architect/tech-lead must resolve before schema design, two of which are
pre-existing defects this swap will make materially worse (unbounded orphan
growth in Postgres, and a byte-corruption regression guard that only two of
four read routes actually adopted).

**Verdict: READY WITH NOTES**

### What I did

- Read the work-log intent/decision/scope.
- Read `src/lib/receipt-storage/index.ts` (interface, factory, `receiptBytesToBodyInit()` regression guard), `local.ts`, `vercel-blob.ts`.
- Read all six consuming route handlers (there are six files, not five — the work-log's "five surfaces" groups the acknowledgment letter's GET+POST as one surface):
  - `src/app/api/admin/ledger/transactions/upload/route.ts` (save)
  - `src/app/api/admin/ledger/transactions/[id]/receipt/route.ts` (read)
  - `src/app/api/admin/ledger/reimbursements/[id]/receipt/route.ts` (read)
  - `src/app/api/members/reimbursements/upload/route.ts` (save)
  - `src/app/api/members/reimbursements/[id]/receipt/route.ts` (read)
  - `src/app/api/admin/ledger/acknowledgments/[id]/letter/route.ts` (read + save + delete)
- Checked `src/app/api/admin/ledger/transactions/[id]/route.ts` for receipt-replace/remove behavior (Flow D — `receiptStorageKey: null`).
- Checked whether any tests exercise `getReceiptStorage()` (only `local.ts` is unit-tested directly, via `LocalReceiptStorage` construction — no test currently calls the factory or hits a route handler over HTTP for receipts).

### User verbs (surface: unchanged from shipped v1.31–v1.32 behavior)

No new verbs. Existing verbs, all **signed-in member** or **admin** surface:

- Admin **attaches** a receipt to a ledger transaction (upload, then reference the key on create/edit).
- Admin **views** a transaction receipt (opens in new tab).
- Admin **waives** a transaction's receipt requirement (separate flow, does not touch storage).
- Admin **removes/replaces** a transaction's receipt (Flow D, PATCH with `receiptStorageKey: null` or a new key).
- Member **attaches** a receipt to a reimbursement request (upload, then submit).
- Member **views** their own reimbursement receipt.
- Admin **views** a member's reimbursement receipt.
- Admin **uploads** an acknowledgment letter for a gift acknowledgment; **views** it; the system **replaces** it (delete-then-save) on re-upload.

### Flows

All six flows are `entry (button/link) → multipart POST or GET → storage adapter call → outcome`. I re-verified each against the interface rather than re-deriving them, since the intent doc already enumerates them correctly. One flow deserves explicit callout:

**Flow D — remove/replace a transaction receipt** (`PATCH /api/admin/ledger/transactions/[id]`, line ~355-357 of that route): when `receiptStorageKey` is set to `null`, the handler nulls the DB column but **never calls `getReceiptStorage().delete()`** on the old key. The old bytes are orphaned in whatever backend is active. Today that's a harmless, cheap orphan in Vercel Blob. Under a DB adapter it's a permanently-retained row in a Postgres table with no cleanup path. See Gaps.

Failure outcome across all six flows is uniform and already correct: `read()` → `null` → JSON 404 with human copy ("Receipt file not found" / "No letter file stored..."); network/DB errors → catch-all 500 with human copy ("Failed to upload receipt" / "Failed to retrieve receipt"). No stack traces leak to the client in any of the six routes.

### Permissions

Unchanged, confirmed per-route:

- Transaction upload/view: `LEDGER_RECORD` (upload) / `LEDGER_VIEW` (view).
- Acknowledgment letter GET+POST: `LEDGER_RECORD` for both (GET returns 403, not 404, on ack IDs — enumeration guard, correctly implemented).
- Member reimbursement upload/view: ownership check (`session.user.memberId`), not a `FEATURES` key — correct, this is member-owned data.
- Admin reimbursement view: `LEDGER_VIEW`.

No new `FEATURES` key needed. This swap changes nothing about who can do what.

### Gaps the request didn't address

1. **Adapter-selection signal is undefined, and this is the question the architect most needs to answer.** The factory keys off `BLOB_READ_WRITE_TOKEN` presence today. `DATABASE_URL` is present in *every* environment, including local dev and (if any test ever calls `getReceiptStorage()` instead of constructing `LocalReceiptStorage` directly, which none do today) unit tests. Simply flipping the condition to "DB present → use DB adapter" would mean **every environment always uses the DB adapter**, including local dev — killing the zero-config `.receipt-store/` dev experience the Local adapter was built for (DECISION-020), and putting real network+DB round-trips into any future test that calls the factory. The architect needs to pick an explicit selection signal (e.g., a new opt-in env var, `NODE_ENV === "production"`, or keep `LocalReceiptStorage` for dev/test and only ever construct the DB adapter when the app is actually running against production infra). I'm not resolving this — flagging it as the load-bearing decision this whole feature hinges on.
2. **Orphan-bytes accumulation gets materially worse, unbounded, forever.** Confirmed at `src/app/api/admin/ledger/transactions/[id]/route.ts` line ~355-357: removing or replacing a transaction's receipt sets `receiptStorageKey = null` in the DB but never calls `delete()` on the old key. This is a pre-existing defect (today it silently orphans a Blob object — cheap, and Blob is disposable external storage). Move the bytes into Postgres and every orphan is now a permanent row inside the primary database, counted against Neon's storage tier and backed up in every DB snapshot forever, with no reaper. The acknowledgment-letter POST route (`.../acknowledgments/[id]/letter/route.ts` line 156-163) *does* call `delete()` on replace — so the codebase already knows the right pattern, it's just not applied to the transaction-receipt Flow D path. This should be fixed as part of this change, not left as a new landmine in the new home.
3. **The byte-corruption regression guard (`receiptBytesToBodyInit()`) is only adopted by 2 of 4 read routes — and switching to a new byte source is exactly when this bug class resurfaces.** `transactions/[id]/receipt/route.ts` and `admin/ledger/reimbursements/[id]/receipt/route.ts` correctly call `receiptBytesToBodyInit(stored.bytes)`. But `acknowledgments/[id]/letter/route.ts` (line 77) and `members/reimbursements/[id]/receipt/route.ts` (line 50) still do the unguarded `new Response(stored.bytes.buffer as ArrayBuffer, ...)` — the exact pattern the guard's own doc-comment says caused response-body corruption in production. Whether a DB adapter's returned `Buffer` is subject to Node's small-allocation pooling behavior depends on how `pg`/Drizzle constructs it from the wire protocol — untested, and the two routes that skip the guard have no protection either way. This should be fixed (route both remaining call sites through `receiptBytesToBodyInit()`) as part of this change, before the byte source changes underneath them.
4. **Interface-contract semantics (Pass 2, as requested):** confirmed `read()` → `null` → 404 is uniform across all four read routes; confirmed `delete()` is called in only-existing-key contexts and treated as safe to no-op (Local: `fs.existsSync` guard; Blob: catch-and-ignore). A DB adapter's `save()` must be an upsert (`INSERT ... ON CONFLICT (key) DO UPDATE`), matching Blob's `allowOverwrite: true` and Local's unconditional `writeFileSync` — this matters concretely for Flow D-adjacent cases where a form is resubmitted with the same key. `delete()` on a missing key must not throw. `read()` on a missing key must return `null`, not throw. This is exactly the semantics the intent doc names; I'm confirming them, not adding new ones.
5. **Failure microcopy: unaffected, no action needed.** The generic 500 ("Failed to upload receipt" / "Failed to retrieve receipt") is backend-agnostic and stays correct under a DB adapter — a DB write/read failure is exactly as generic-500-worthy as a filesystem or Blob failure was. I don't think this needs new copy; flagging only because the brief asked me to check.
6. **Size/perf: worth the architect's attention but not a blocker.** 10 MB server-side cap, realistically 200-500 KB per file after client-side downscaling. Storing as `bytea` directly on a wide, frequently-queried table (e.g., inline on `ledgerTransactions`) would bloat every `SELECT *`-shaped query and inflate autovacuum/backup cost even for rows nobody's viewing. A separate bytes table (`receipt_files(key PK, content_type, bytes, created_at)`), which the work-log's scope section already sketches, is the right shape — flagging to confirm the architect keeps bytes off the transaction/reimbursement/acknowledgment rows themselves, not just off any one of them.
7. **Concurrent upload of the same key:** the key is a fresh `crypto.randomUUID()` per upload (`receipts/<uuid>/<name>`), so two concurrent uploads never collide on the same key in practice — this is a non-issue for `save()`. The Flow D-replace path is the only place an existing key could theoretically get a second `save()` call, and it doesn't (it deletes-then-saves under a *new* key, per the acknowledgment route's pattern). No adversarial finding here beyond confirming `save()` must still be upsert-safe per point 4.
8. **Local dev experience:** if the architect keeps `LocalReceiptStorage` for local dev (my recommendation embedded in gap 1), the existing `.receipt-store/` files keep working exactly as today — no dev-experience regression. If the architect instead makes the DB adapter universal, every local-dev contributor needs a reachable `DATABASE_URL` before receipts work at all, which is already true for this project (Neon `DATABASE_URL` in `.env.local`) — so this is a low-risk path either way, but it's the architect's call, not mine.

### Out of scope (confirm with user)

- No data migration — already user-confirmed in the intent doc (no existing production receipts to move). Not re-litigating.
- Whether `@vercel/blob` and the Blob/Local adapter files get deleted outright or `LocalReceiptStorage` is kept for dev/test — already flagged in the work-log as the architect's call; my gap 1 above narrows *why* that choice matters (it's not cosmetic, it determines whether tests/dev start hitting a real DB).

### Open questions

- Should `LocalReceiptStorage` remain the dev/test adapter permanently (recommended), or is the intent to standardize on the DB adapter everywhere including local dev? This determines the adapter-selection signal in gap 1.
- Is fixing the Flow D orphan-delete gap (gap 2) and the two unguarded response-body call sites (gap 3) in scope for *this* work item, or should they be spun out as separate bug-fix work-log entries so this infra swap doesn't balloon? I'd bundle them here since they're on the direct code path being touched and get materially worse post-swap, but that's the user's call on scope.

---

## Phase 2 — Architectural Review — 2026-07-21

**Owner:** architect
**Status:** complete

### Summary

**Verdict: Approved with suggestions.** The scope, table shape, and defect-bundling
the analyst flagged are all sound; I've resolved the one load-bearing open
question (adapter-selection signal) and locked the table design. Suggestions are
noted below — none block Phase 3.

### What I did

- Read the Phase 1 functional refinement in full (all 8 gaps, all open questions).
- Read `src/lib/receipt-storage/index.ts`, `local.ts`, `vercel-blob.ts` — confirmed
  the `ReceiptStorage` interface, the `receiptBytesToBodyInit()` regression guard,
  and today's `BLOB_READ_WRITE_TOKEN`-presence selection rule.
- Read `src/lib/db/schema.ts` (table-definition conventions — `ledgerReimbursements`
  as the closest sibling: uuid PK vs. text PK precedent, index style, comment style)
  and `src/lib/db/index.ts` (confirmed the DB driver: `drizzle-orm/postgres-js` +
  the `postgres` npm package — **not** `pg`/node-postgres, which changes the
  byte-corruption-guard analysis).
- Read DECISION-020 in full (original adapter-selection rationale, opaque-key
  model, proxy-route-streams-not-redirects rule).
- Searched `src/lib/db/` and `schema.ts` for any prior `customType` / `bytea`
  usage — none exists. This is the first binary column in the project.
- Read `drizzle/migrations/0058_ledger_public_note.sql` for current idempotent
  single-column-add migration style, and skimmed the migration directory listing
  for naming convention (`00NN_description.sql`).
- Read the Flow D snippet in `src/app/api/admin/ledger/transactions/[id]/route.ts`
  (~line 330-370) directly to confirm the analyst's orphan-bytes finding.
- Confirmed `drizzle-orm@^0.45.2` (already installed) ships `customType` in
  `drizzle-orm/pg-core` — no new dependency required for the table.

### Rulings

**1. Adapter-selection signal.** `process.env.NODE_ENV === "production"` → 
`DatabaseReceiptStorage`; otherwise → `LocalReceiptStorage`. **No new environment
variable**, in production or anywhere else. Rejected the opt-in-var option
(`RECEIPT_STORAGE=database`) because it reintroduces the exact footgun class this
work exists to remove — a manually-set flag that can be forgotten, and forgetting
it silently reselects `LocalReceiptStorage` in production, which is the precise
failure that broke uploads. Rejected "DB always, drop Local" because it forces a
reachable `DATABASE_URL` onto every local contributor and any future test that
calls the factory, with no mocking seam anywhere in this codebase for that
boundary — the zero-config `.receipt-store/` dev experience DECISION-020 built is
worth keeping. `NODE_ENV` wins because it's platform-set (by `next build`/`next
start`, by Vitest, by Playwright, by `pnpm dev`) rather than admin-configured, so
it cannot be silently left unset the way `BLOB_READ_WRITE_TOKEN` was — and because
it happens to correlate exactly with the real constraint (no persistent writable
filesystem), covering both Vercel Production *and* Preview deployments (both
share `DATABASE_URL`; neither has a writable FS), not just Production. `@vercel/blob`
and `src/lib/receipt-storage/vercel-blob.ts` are removed outright — no dead
branch, no lingering dependency. Full text: DECISION-040.

**2. Table design.** Confirmed as sketched, with the customType and naming spelled
out: a dedicated `ledger_receipt_files` table (`ledger_*` prefix — every current
consumer is Ledger-domain), **not** a `bytea` column on the hot transaction/
reimbursement/acknowledgment rows. Columns: `key text primary key` (the existing
`receipts/<uuid>/<name>` format, DECISION-020 unchanged), `content_type text not
null`, `bytes bytea not null` via a new `customType<{ data: Buffer; driverData:
Buffer }>({ dataType: () => "bytea" })` export in `schema.ts`, `byte_size integer
not null`, `created_at timestamptz not null default now()`. No `CHECK` constraint
on `key`'s shape — matches this codebase's established precedent of validating
pattern/enum-shaped columns at the app layer only. Table goes in `schema.ts`
first; migration is `CREATE TABLE IF NOT EXISTS ledger_receipt_files (...)`,
trivially idempotent since it's a brand-new table. 10 MB rows are unremarkable
for Postgres `bytea`/TOAST and for `postgres.js`'s wire handling — no config
changes needed anywhere.

**3. The two pre-existing defects: both IN SCOPE for this work item, not deferred.**
   - **Orphan-bytes** (Flow D, `transactions/[id]/route.ts` ~line 355): add the
     missing `getReceiptStorage().delete(oldKey)` call. It sits on a file this
     change already touches conceptually (the backing store for the bytes being
     orphaned), it's a few lines, and it converts from "cheap Blob litter" to
     "permanent primary-database row growth" specifically because of this swap —
     leaving it unfixed plants a landmine in the new home the analyst already
     named. Fold in.
   - **Byte-corruption guard gap** (`acknowledgments/[id]/letter/route.ts` line 77,
     `members/reimbursements/[id]/receipt/route.ts` line 50): route both through
     `receiptBytesToBodyInit()`. I resolved the analyst's "untested" question:
     this project's driver is `postgres.js` (confirmed via `src/lib/db/index.ts`),
     which decodes `bytea` via `Buffer.from(hexString, "hex")` — a code path
     subject to the same small-allocation pooling as `fs.readFileSync`
     (nonzero `byteOffset` into a shared pool `ArrayBuffer` below `Buffer.poolSize
     >> 1`). The bug class the guard was written for is concretely reachable
     again on the new byte source, not just cheap insurance. Fold in.

   Neither is spun into a separate bug-fix work-log — both are small, sit on
   files this change modifies or directly interacts with, and get strictly worse
   or newly-live as a direct consequence of the adapter swap. Call this out as
   two distinct line items in the Phase 3 design and Phase 4 implementation notes
   so they stay independently auditable.

**4. Invariants.** Schema-is-source-of-truth: `ledgerReceiptFiles` goes into
`schema.ts` before the migration is written. Migration is idempotent by
construction (`CREATE TABLE IF NOT EXISTS`). No new required-in-production env
var — confirmed the `NODE_ENV` signal is strictly better than the
`BLOB_READ_WRITE_TOKEN` regime it replaces because it cannot be forgotten by a
human. `ReceiptStorage` interface (`save`/`read`/`delete`) is preserved exactly:
`save()` must be `INSERT ... ON CONFLICT (key) DO UPDATE SET content_type =
excluded.content_type, bytes = excluded.bytes, byte_size = excluded.byte_size`
(upsert, matching Blob's `allowOverwrite: true` / Local's unconditional
`writeFileSync`); `read()` returns `null` on a missing key, never throws;
`delete()` no-ops on a missing key, never throws. `receiptBytesToBodyInit()`
remains a route-level concern (called by all four read routes on the `Buffer`
the adapter returns), not something the adapter itself needs to apply.

### Suggestions (non-blocking)

- Tech-lead should confirm whether `created_at` on `ledger_receipt_files` should
  be re-stamped on the `ON CONFLICT DO UPDATE` path or left immutable from first
  insert — low-stakes either way since replace-in-practice goes through
  delete-then-save-under-a-new-key everywhere except the theoretical idempotent-
  resubmit case, but pick one explicitly rather than leaving it implicit.
  Recommend: leave `created_at` untouched on conflict (don't add it to the
  `DO UPDATE SET` list) — matches "first write wins for the timestamp" and is
  one fewer thing to reason about.
  - No `updated_at` column needed — this table has no audit/history requirement
    across versions, unlike `users`/`ledgerReimbursements`.
- When removing `@vercel/blob` from `package.json`, also grep for any remaining
  `BLOB_READ_WRITE_TOKEN` references outside `receipt-storage/` (e.g. any
  leftover mention in `CLAUDE.md`'s Environment Variables list) and clean those
  up in the same PR — tech-lead/deployment-engineer's call on exactly where, but
  don't leave a stale required-var entry in the docs pointing at a removed
  dependency.
- `DatabaseReceiptStorage` should live at `src/lib/receipt-storage/database.ts`,
  sibling to `local.ts`/`vercel-blob.ts` — no new directory needed.

### Outputs

- `docs/decisions.md`: **DECISION-040** — adapter-selection rule, table shape,
  defect bundling, `@vercel/blob` removal.
- `docs/work-log/2026-07-21-receipt-storage-in-database.md` — this Phase 2 section;
  status table row updated to `complete` / `Approved with suggestions`.

### Open questions / handoff notes

- Tech-lead (Phase 3) should name the exact migration filename (next in sequence
  after `0059_ledger_reconciliation_sessions.sql`, so `0060_...`) and write the
  full `DatabaseReceiptStorage` method bodies, including the two defect fixes
  called out above as explicit implementation steps (not folded silently into
  the adapter's own diff — they touch different files).
- Implementer sequence per the established Ledger pattern: **database-admin**
  (schema + migration) → **api-developer** (`DatabaseReceiptStorage`, factory
  change, the two defect fixes, `@vercel/blob` removal). No UI work — this is a
  backend-only swap, confirmed by the analyst (zero new routes, zero new
  components).
- No `FEATURES` change, no new route, no new page — `ux-developer` is not needed
  in Phase 4 for this work item.

---

## Phase 3 — Technical Design — 2026-07-21

**Owner:** tech-lead
**Status:** complete

### Summary

Backend-only adapter swap: bytes move from Vercel Blob to a new Postgres table
(`ledger_receipt_files`), selected via `NODE_ENV === "production"` per
DECISION-040. No new route, no new page, no new `FEATURES` key. Two
pre-existing defects (Flow D orphan-bytes, byte-corruption guard gap on two
read routes) are fixed as part of this work, per architect Ruling 3. Below is
the exact file list, table/customType definitions, migration DDL, adapter
method bodies, factory rewrite, the two defect fixes as line-level edits, and
the full unit-test list Phase 4 must deliver.

### Permissions

No changes. `LEDGER_VIEW` / `LEDGER_RECORD` / ownership gates on all six
consuming routes are untouched — confirmed unchanged by the Phase 1 analyst
review; this design does not touch any `auth()`/`hasFeature()` call site.

### API Contract

No new routes, no server-action signature changes. `ReceiptStorage`
(`save`/`read`/`delete`) is unchanged as a TypeScript interface — only the
concrete adapter selected by `getReceiptStorage()` changes. Two existing route
handlers get internal line-level fixes (below); their request/response
contracts are unchanged.

### Data Model

New table, `schema.ts` first (source of truth), then an idempotent migration.

**`src/lib/db/schema.ts`** — add to the `drizzle-orm/pg-core` import line:

```ts
import { pgTable, text, timestamp, uuid, boolean, integer, date, jsonb, unique, index, uniqueIndex, varchar, customType, type AnyPgColumn } from "drizzle-orm/pg-core";
```

Append at the end of the file (after `failedLoginAttempts`/`FailedLoginAttempt`,
following this file's established "append newest table at the end" pattern —
see the Bank Reconciliation inc2 block for precedent):

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Receipt Storage in the Database — DECISION-040
// Bytes for ledger transaction receipts, reimbursement receipts, and
// acknowledgment letters, keyed by the existing opaque
// `receipts/<uuid>/<name>` / `acknowledgments/<uuid>/<name>` key (DECISION-020
// format, unchanged). Deliberately a side table, not a bytea column on
// ledger_transactions/ledger_reimbursements/ledger_acknowledgments — keeps
// those hot, frequently-SELECT *'d rows narrow (same reasoning that produced
// ledger_filings, ledger_reconciliation_matches, etc. as side tables).
// created_at is NOT re-stamped on ON CONFLICT DO UPDATE (see
// DatabaseReceiptStorage.save()) — first-write-wins for the timestamp,
// deliberate per architect Suggestion.
// ─────────────────────────────────────────────────────────────────────────────

/** First binary column in this schema. driverData/data both Buffer — postgres.js decodes bytea to Buffer natively, no custom to/fromDriver mapping needed. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const ledgerReceiptFiles = pgTable("ledger_receipt_files", {
  key: text("key").primaryKey(), // receipts/<uuid>/<name> or acknowledgments/<uuid>/<name> — DECISION-020 format
  contentType: text("content_type").notNull(),
  bytes: bytea("bytes").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LedgerReceiptFile = typeof ledgerReceiptFiles.$inferSelect;
export type NewLedgerReceiptFile = typeof ledgerReceiptFiles.$inferInsert;
```

**Migration** — `drizzle/migrations/0060_ledger_receipt_files.sql` (confirmed
next-free number: latest existing file is `0059_ledger_reconciliation_sessions.sql`).
Trivially idempotent — brand-new table, no `ALTER`/`DO $$` guards needed:

```sql
-- Receipt Storage in the Database (DECISION-040): bytes for ledger transaction
-- receipts, reimbursement receipts, and acknowledgment letters move from
-- Vercel Blob into Postgres. See docs/work-log/2026-07-21-receipt-storage-in-database.md
-- for the full design.
--
-- No data migration — there are no existing production receipts to move
-- (production uploads were failing before this change; user-confirmed).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS. Brand-new table, safe to re-run.

CREATE TABLE IF NOT EXISTS ledger_receipt_files (
  key          text        PRIMARY KEY,
  content_type text        NOT NULL,
  bytes        bytea       NOT NULL,
  byte_size    integer     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

No indexes beyond the primary key — every read is a point lookup by `key`
(the opaque storage key), never a range scan or filter on any other column.

### Component/Page Plan

None. No pages, no components — confirmed by the Phase 1 analyst (zero new
user verbs) and Phase 2 architect (no UI work).

### File List

**Created:**
- `src/lib/receipt-storage/database.ts` — `DatabaseReceiptStorage` adapter (database-admin)
- `src/lib/receipt-storage/database.test.ts` — unit tests for the adapter (database-admin)
- `drizzle/migrations/0060_ledger_receipt_files.sql` (database-admin)

**Modified:**
- `src/lib/db/schema.ts` — `bytea` customType + `ledgerReceiptFiles` table (database-admin)
- `src/lib/receipt-storage/index.ts` — factory rewrite, doc-comment update (api-developer)
- `src/lib/receipt-storage/local.ts` — doc-comment only: replace the
  "BLOB_READ_WRITE_TOKEN absent" selection description with the NODE_ENV rule
  (api-developer)
- `src/lib/receipt-storage/receipt-storage.test.ts` — update the factory
  not-unit-testable comment block (lines ~187-193) to describe the NODE_ENV
  rule instead of BLOB_READ_WRITE_TOKEN; no test logic changes, no Blob
  adapter references exist in this file today (confirmed) (api-developer)
- `src/app/api/admin/ledger/transactions/[id]/route.ts` — Flow D orphan-delete
  fix (api-developer)
- `src/app/api/admin/ledger/acknowledgments/[id]/letter/route.ts` — GET
  routed through `receiptBytesToBodyInit()` (api-developer)
- `src/app/api/members/reimbursements/[id]/receipt/route.ts` — GET routed
  through `receiptBytesToBodyInit()` (api-developer)
- `package.json` / `pnpm-lock.yaml` — `pnpm remove @vercel/blob` (api-developer)
- `CLAUDE.md` — remove the `BLOB_READ_WRITE_TOKEN` line from the Environment
  Variables list (architect Suggestion; api-developer, same PR)

**Deleted:**
- `src/lib/receipt-storage/vercel-blob.ts` (api-developer)

### DatabaseReceiptStorage — method bodies

`src/lib/receipt-storage/database.ts`:

```ts
/**
 * DatabaseReceiptStorage adapter — DECISION-040.
 *
 * Used in production (NODE_ENV === "production"). Bytes live in the
 * ledger_receipt_files table, keyed by the same opaque
 * receipts/<uuid>/<name> key format as the other two adapters (DECISION-020).
 */

import { db } from "@/lib/db";
import { ledgerReceiptFiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { ReceiptStorage } from "./index";

export class DatabaseReceiptStorage implements ReceiptStorage {
  async save(key: string, bytes: Buffer | Uint8Array, contentType: string): Promise<void> {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    await db
      .insert(ledgerReceiptFiles)
      .values({
        key,
        contentType,
        bytes: buf,
        byteSize: buf.byteLength,
      })
      .onConflictDoUpdate({
        target: [ledgerReceiptFiles.key],
        set: {
          contentType,
          bytes: buf,
          byteSize: buf.byteLength,
          // createdAt intentionally omitted — first-write-wins (architect Suggestion)
        },
      });
  }

  async read(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const rows = await db
      .select({ bytes: ledgerReceiptFiles.bytes, contentType: ledgerReceiptFiles.contentType })
      .from(ledgerReceiptFiles)
      .where(eq(ledgerReceiptFiles.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { bytes: row.bytes, contentType: row.contentType };
  }

  async delete(key: string): Promise<void> {
    // DELETE ... WHERE on a non-matching key affects 0 rows and does not
    // throw — no existence check needed to satisfy the interface's
    // no-op-on-missing-key contract.
    await db.delete(ledgerReceiptFiles).where(eq(ledgerReceiptFiles.key, key));
  }
}
```

### Factory rewrite

`src/lib/receipt-storage/index.ts` — replace the module doc-comment (lines 1-14)
and the factory (lines 101-145):

```ts
/**
 * Pluggable receipt storage interface — DECISION-020, adapter selection
 * amended by DECISION-040.
 *
 * `getReceiptStorage()` selects the adapter at runtime based on NODE_ENV:
 *
 *   - NODE_ENV === "production" → DatabaseReceiptStorage (Postgres, ledger_receipt_files)
 *   - otherwise (development, test) → LocalReceiptStorage (.receipt-store/)
 *
 * No environment variable controls this selection, in production or
 * anywhere else. NODE_ENV is platform-set (next build/next start, Vitest,
 * Playwright, pnpm dev) rather than admin-configured, so it cannot be
 * silently left unset the way BLOB_READ_WRITE_TOKEN was — that gap is what
 * broke production receipt uploads before this change (see work-log intent).
 *
 * The interface stores an opaque `key` (pattern: receipts/<uuid>/<filename>).
 * The key is never a URL — the underlying storage location is never returned
 * to the browser. Receipt reads always go through a server-side proxy route
 * that calls `read()` and streams the bytes.
 */

import type { LocalReceiptStorage } from "./local";
import type { DatabaseReceiptStorage } from "./database";
```

(remove `import type { VercelBlobStorage } from "./vercel-blob";`)

```ts
export function getReceiptStorage(): ReceiptStorage {
  if (_instance) return _instance;

  if (process.env.NODE_ENV === "production") {
    // Lazy synchronous require — avoids loading @/lib/db (and opening a DB
    // connection) in local dev / test, where NODE_ENV !== "production" and
    // this branch never runs.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseReceiptStorage: DRS } = require("./database") as {
      DatabaseReceiptStorage: new () => DatabaseReceiptStorage;
    };
    _instance = new DRS();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LocalReceiptStorage: LRS } = require("./local") as {
      LocalReceiptStorage: new () => LocalReceiptStorage;
    };
    _instance = new LRS();
  }

  return _instance;
}
```

Delete the `FU-6` `console.warn` block entirely — it warned about the exact
footgun (`BLOB_READ_WRITE_TOKEN` silently absent in production) that
DECISION-040 structurally eliminates; there is no longer a "wrong" branch
`NODE_ENV` can silently fall into.

### Defect fix (a) — Flow D orphan-bytes

`src/app/api/admin/ledger/transactions/[id]/route.ts`. Add `getReceiptStorage`
to the existing import (currently `import { RECEIPT_KEY_REGEX } from
"@/lib/receipt-storage";`):

```ts
import { RECEIPT_KEY_REGEX, getReceiptStorage } from "@/lib/receipt-storage";
```

Immediately after the existing `receiptStorageKey` validation block (ends at
the line setting `update.receiptWaiverReason = null;`, ~line 375) and before
the `donorId` block, capture whether an old key needs cleanup:

```ts
// DECISION-040 defect fix (a): capture the previous receipt key so its bytes
// can be deleted after a successful remove/replace. Only fires when
// receiptStorageKey is actually changing to a *different* value than what's
// already stored — an idempotent resubmit of the same key must not delete
// the very bytes it's pointing at.
const oldReceiptKeyToDelete =
  body.receiptStorageKey !== undefined &&
  existing.receiptStorageKey &&
  existing.receiptStorageKey !== update.receiptStorageKey
    ? existing.receiptStorageKey
    : null;
```

This one expression covers both sub-cases without branching: `null` clears
(`update.receiptStorageKey` becomes `null`, which differs from any non-null
`existing.receiptStorageKey`) and a new key replaces (differs from the old
string). A same-key resubmit (`update.receiptStorageKey === existing.receiptStorageKey`)
correctly yields `null` — no delete.

Then, immediately after the `if (updateBoth && existing.transferGroupId) { ... }
else { ... }` block that performs the actual `db.update(...)` (right before
`return NextResponse.json({ id });`):

```ts
// Best-effort cleanup, deliberately AFTER the DB write succeeds — the DB row
// is the source of truth for which key is "live"; only delete bytes once
// nothing references them anymore. (Differs from the acknowledgment-letter
// route's delete-BEFORE-save: that route is uploading new bytes in the same
// request, so it must free the old key before writing the new one; this
// route only ever receives an already-uploaded key, so there's no ordering
// hazard — deleting after is strictly safer here.) Non-fatal: an orphan is
// a recoverable data-hygiene issue, not worth failing the edit over.
if (oldReceiptKeyToDelete) {
  try {
    await getReceiptStorage().delete(oldReceiptKeyToDelete);
  } catch (err) {
    console.error(
      "[transaction-receipt] Failed to delete old receipt key:",
      oldReceiptKeyToDelete,
      err,
    );
  }
}
```

### Defect fix (b) — byte-corruption guard adoption

Two call sites, identical shape of fix. In both files, add
`receiptBytesToBodyInit` to the existing `@/lib/receipt-storage` import and
replace the unguarded `Response` construction:

**`src/app/api/admin/ledger/acknowledgments/[id]/letter/route.ts`** (GET, ~line 77):

```ts
// before
import { getReceiptStorage } from "@/lib/receipt-storage";
...
return new Response(stored.bytes.buffer as ArrayBuffer, {

// after
import { getReceiptStorage, receiptBytesToBodyInit } from "@/lib/receipt-storage";
...
return new Response(receiptBytesToBodyInit(stored.bytes), {
```

**`src/app/api/members/reimbursements/[id]/receipt/route.ts`** (GET, ~line 50):
identical change — `import { getReceiptStorage, receiptBytesToBodyInit } from
"@/lib/receipt-storage";`, then `return new Response(receiptBytesToBodyInit(stored.bytes), {`.

Optional consistency nit (not required for correctness — `Buffer#length` and
`Buffer#byteLength` are identical for a `Buffer`): both files currently
compute `Content-Length` as `stored.bytes.length.toString()`, while the two
already-guarded routes use `stored.bytes.byteLength.toString()`. api-developer
may align these while touching the file; not a gate.

### Implementation Order

1. **database-admin**: add `bytea` customType + `ledgerReceiptFiles` table to
   `schema.ts`; write `drizzle/migrations/0060_ledger_receipt_files.sql`; run
   `pnpm db:migrate` against the local DB; create
   `src/lib/receipt-storage/database.ts`; write `database.test.ts` (list
   below).
2. **api-developer**: rewrite the `getReceiptStorage()` factory and its
   doc-comment in `index.ts`; update `local.ts`'s doc-comment; delete
   `vercel-blob.ts`; `pnpm remove @vercel/blob`; apply defect fix (a) to
   `transactions/[id]/route.ts`; apply defect fix (b) to the two read routes;
   update the factory-not-testable comment in `receipt-storage.test.ts`;
   remove the `BLOB_READ_WRITE_TOKEN` line from CLAUDE.md's Environment
   Variables list.
3. No ux-developer step — no UI surface changes.

### Full unit-test list (Phase 4 gate)

**`src/lib/receipt-storage/database.test.ts`** (new, database-admin) — mock
`@/lib/db` per this codebase's established style (`vi.mock("@/lib/db", ...)`,
see `src/lib/permissions-server.test.ts`), building nested `vi.fn()` chains
that mirror the exact Drizzle builder shape each method calls (e.g.
`db.insert = vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoUpdate:
vi.fn().mockResolvedValue(undefined) })) }))`). This verifies
`DatabaseReceiptStorage` calls the correct builder methods with the correct
arguments — it does not exercise real Postgres `bytea` wire encoding, which
no test in this codebase currently mocks at this depth (confirmed: no
existing test mocks a chained Drizzle query). That gap is closed at the
integration level, not the unit level — see qa note below.

1. `save()` calls `db.insert(ledgerReceiptFiles).values(...)` with `key`,
   `contentType`, the raw `bytes` Buffer, and `byteSize` computed from the
   buffer's length.
2. `save()` calls `.onConflictDoUpdate({ target: [ledgerReceiptFiles.key], set: {...} })`
   with `contentType`/`bytes`/`byteSize` in `set`, and confirms `createdAt` is
   **not** present in `set` (regression guard for the "first-write-wins"
   decision).
3. `save()` converts a `Uint8Array` input to a `Buffer` before computing
   `byteSize` and passing it to `values()` (mirrors `VercelBlobStorage`'s
   existing `Buffer.isBuffer` coercion).
4. `read()` returns `{ bytes, contentType }` when `db.select(...)` resolves a
   one-row array.
5. `read()` returns `null` when `db.select(...)` resolves an empty array
   (covers: a `ledger_transactions`/`ledger_reimbursements` row referencing a
   key with no `ledger_receipt_files` row — the orphan-key-from-a-pre-fix-upload
   edge case named in the brief; unchanged, correct behavior, caller 404s).
6. `read()` calls `.where(eq(ledgerReceiptFiles.key, key))` with the exact key
   passed in, and `.limit(1)`.
7. `delete()` calls `db.delete(ledgerReceiptFiles).where(eq(ledgerReceiptFiles.key, key))`
   and resolves without throwing.
8. `delete()` resolves without throwing when the mocked delete chain
   "affects" zero rows (simulates deleting a key whose bytes were never
   written — no-op, per interface contract).
9. `save()` can be called twice in a row with the same key without throwing
   (simulates the concurrent-save-of-same-key and re-upload-of-same-key edge
   cases — both are handled by Postgres's `ON CONFLICT`, which this test
   confirms the adapter invokes on every call, not just the first).

**`src/lib/receipt-storage/receipt-storage.test.ts`** (modified,
api-developer) — no new test cases; update the comment block at lines
~187-193 (the "factory not directly unit-testable" note) to describe the
`NODE_ENV` selection rule instead of `BLOB_READ_WRITE_TOKEN`. The factory
itself remains untestable in this Vitest config for the same reason as
today (synchronous `require()` doesn't resolve in the ESM test environment) —
this is not a regression introduced by this change, and QA's e2e run (see
below) is the closest thing to an integration test of the production branch.

**No new tests for the two route-level defect fixes.** Neither
`transactions/[id]/route.ts` nor the two read routes are unit-tested today
(confirmed by the Phase 1 analyst: no test calls the factory or exercises a
receipt route over HTTP) — this is consistent with the rest of this
codebase's route-handler testing approach, which relies on QA's manual
click-through / Playwright e2e rather than Vitest route mocks. QA's Phase 5
must explicitly exercise: (1) attach receipt → remove receipt → confirm no
orphan row accumulates (can spot-check via the ledger admin UI / a one-off
`SELECT count(*) FROM ledger_receipt_files`), and (2) view a receipt/letter
through both of the two newly-fixed routes and confirm the returned bytes are
byte-identical to the uploaded file (the exact regression class
`receiptBytesToBodyInit()` exists to prevent).

**Total: 9 new unit tests** (`database.test.ts`), plus one comment-only edit
to an existing test file (no new test count).

### Edge Cases & Risks

- **Upsert on re-upload of same key.** Handled by `ON CONFLICT (key) DO
  UPDATE` — covered by unit test 9. In practice this path is rarely hit
  (upload keys are fresh UUIDs per upload; Flow D's replace path deletes the
  old key rather than reusing it), but the interface contract requires it and
  `VercelBlobStorage`/`LocalReceiptStorage` both already support it.
- **Delete of a key whose bytes were never written** (an orphan key
  referenced by a `ledger_transactions`/`ledger_reimbursements` row from a
  failed pre-fix upload). `DELETE ... WHERE key = $1` affects 0 rows and does
  not throw — covered by unit test 8. No special-casing needed.
- **A row referencing a key with no `ledger_receipt_files` row.**
  `read()` returns `null` → the calling route already 404s on `null` in all
  four read routes (unchanged, correct — confirmed by the Phase 1 analyst).
  Covered by unit test 5.
- **Concurrent save of the same key.** `ON CONFLICT` is handled atomically by
  Postgres; no application-level locking needed. Covered by unit test 9 at
  the call-shape level; the atomicity guarantee itself is Postgres's, not
  this adapter's, to prove.
- **`bytea` wire round-trip fidelity (postgres.js hex-decode →
  `receiptBytesToBodyInit()`) is not unit-testable** — it requires a real
  Postgres connection. This is why the byte-corruption guard fix (defect b)
  matters even though it can't get a unit test: it's the same defensive copy
  used by the two already-guarded routes, applied prophylactically to the two
  that weren't, before the byte source changes underneath them. QA's Phase 5
  e2e run is the actual verification of round-trip fidelity.
- **QA must apply the migration before `next start`.** `next start` sets
  `NODE_ENV=production`, so the Playwright e2e run will exercise
  `DatabaseReceiptStorage` against whichever DB the local `DATABASE_URL`
  points at. `pnpm build:only` runs `pnpm db:migrate` first, so as long as
  QA runs the standard `pnpm build:only` → `pnpm start` sequence (not a
  bypassed build), the migration will already be applied. Flagging explicitly
  because this is the first time a Vitest-green / build-green feature also
  requires the migration to be live before its own e2e pass can succeed.
- **`@vercel/blob` removal is a hard cutover, no fallback.** If
  `DatabaseReceiptStorage` has a bug that only manifests in production
  (e.g., a `bytea` encoding edge case), there is no Blob adapter to fall back
  to — this is the tradeoff DECISION-040 already accepted explicitly (matches
  the user's stated intent to remove the external dependency entirely, not
  keep it as a hidden safety net).

### Out of Scope

- No data migration (user-confirmed, Phase 1 — no existing production
  receipts to move).
- No change to the `ReceiptStorage` interface itself (`save`/`read`/`delete`
  signatures unchanged).
- No route or UI changes beyond the two defect-fix line edits named above —
  every consuming route already goes through `getReceiptStorage()`.
- No retention/cleanup job for `ledger_receipt_files` (e.g., a periodic reaper
  for any orphans that predate defect fix (a)) — not requested, and there are
  zero production receipts today so there's nothing to reap at cutover.

### Outputs

- `docs/work-log/2026-07-21-receipt-storage-in-database.md` — this Phase 3
  section; status table row updated to `complete`.
- No new `docs/decisions.md` entry — this design implements DECISION-040
  exactly as ruled by the architect; no additional implementation-level
  decision was made that diverges from or adds to that ruling. (The
  `onConflictDoUpdate` target-as-array syntax and the delete-after-vs-
  delete-before ordering in defect fix (a) are implementation detail within
  DECISION-040's scope, not a new decision — noted inline above instead.)

### Open questions / handoff notes

- **Implementer sequence:** **database-admin** first (schema + migration +
  `DatabaseReceiptStorage` + its 9 unit tests), then **api-developer**
  (factory rewrite, `@vercel/blob` removal, both defect fixes, their
  supporting doc/test-comment updates). No `ux-developer` — confirmed no UI
  surface changes anywhere in this work item.
- database-admin should run `pnpm db:migrate` locally after adding the
  migration (per CLAUDE.md's "Run migrations after schema changes") so
  `database.ts`'s implementation can be sanity-checked against the migrated
  local schema before api-developer starts, even though the unit tests
  themselves are DB-free (mocked).
- api-developer: confirm after `pnpm remove @vercel/blob` that
  `pnpm exec tsc --noEmit` and `pnpm build:only` are both clean — this
  removes an entire dependency, so double-check no other file in the tree
  (outside the four already identified) imports `@vercel/blob`.
- qa (Phase 5): the migration-before-`next start` ordering risk and the two
  manual verification points (orphan-row spot-check, byte-identical receipt
  view on both newly-fixed routes) are called out explicitly above — please
  carry them into the Phase 5 Build Verification Report rather than
  rediscovering them.

---

## Phase 4 — Implementation (schema) — 2026-07-21

**Owner:** database-admin
**Status:** complete

### Summary

Implemented the schema half of the Phase 3 design exactly as specified: the
`bytea` customType (first binary column in this project), the
`ledger_receipt_files` table, migration `0060_ledger_receipt_files.sql`, the
`DatabaseReceiptStorage` adapter, and its 9-test unit-test suite. No factory
rewrite, no `@vercel/blob` removal, no route edits — those remain
api-developer's half per the Implementation Order in Phase 3.

### What I did

- Read the Phase 3 design doc in full, DECISION-040, `src/lib/db/schema.ts`
  (conventions: append-at-end, `snake_case` columns/`camelCase` TS fields,
  `timestamp(..., { withTimezone: true }).notNull().defaultNow()` for
  `createdAt`, `$inferSelect`/`$inferInsert` type export pairs — confirmed via
  `ledgerFilings`/`failedLoginAttempts` as the two most recent precedents), and
  `src/lib/db/index.ts` (confirmed `drizzle-orm/postgres-js` + `postgres`
  driver, matching the architect's Phase 2 ruling on `bytea` hex-decode
  behavior).
- Read `src/lib/receipt-storage/index.ts` (the `ReceiptStorage` interface,
  `receiptBytesToBodyInit()`, the current `BLOB_READ_WRITE_TOKEN`-based
  factory — untouched by this half), `local.ts`, and `vercel-blob.ts` for
  doc-comment density and the `Buffer.isBuffer` coercion precedent I mirrored
  in `save()`.
- Read `src/lib/receipt-storage/receipt-storage.test.ts` and
  `src/lib/permissions-server.test.ts` for this codebase's `vi.mock("@/lib/db",
  ...)` style and assertion conventions.
- Confirmed no prior `customType`/`bytea` usage anywhere in `schema.ts` (this
  is genuinely the first binary column) and that `drizzle-orm@^0.45.2`
  (already installed) ships `customType` from `drizzle-orm/pg-core` — no new
  dependency.
- Added `customType` to the `drizzle-orm/pg-core` import line in `schema.ts`;
  appended the `bytea` customType export and the `ledgerReceiptFiles` table
  (with `LedgerReceiptFile`/`NewLedgerReceiptFile` type exports) at the end of
  the file, after `failedLoginAttempts`, matching the file's established
  append-newest-at-end pattern.
- Confirmed the next-free migration number by listing
  `drizzle/migrations/*.sql | sort | tail -3` at the start of this phase (per
  CLAUDE.md's rule to pick the number now, not trust the Phase 3 doc's
  proposal) — `0059_ledger_reconciliation_sessions.sql` was still the latest,
  so `0060_ledger_receipt_files.sql` (as the design doc proposed) was in fact
  still free; no collision.
- Wrote `drizzle/migrations/0060_ledger_receipt_files.sql` — a single
  `CREATE TABLE IF NOT EXISTS ledger_receipt_files (...)` statement, trivially
  idempotent (brand-new table).
- Created `src/lib/receipt-storage/database.ts` — `DatabaseReceiptStorage`
  implementing `save`/`read`/`delete` exactly per the Phase 3 method bodies:
  `save()` upserts via `.onConflictDoUpdate({ target: [ledgerReceiptFiles.key], set: {...} })`
  with `contentType`/`bytes`/`byteSize` in `set` and `createdAt` deliberately
  omitted (first-write-wins); `read()` returns `{ bytes, contentType }` or
  `null`; `delete()` is an unconditional `DELETE ... WHERE key = $1` (no
  existence check — matches the interface's no-op-on-missing-key contract).
- Wrote `src/lib/receipt-storage/database.test.ts` — 9 unit tests, mocking
  `@/lib/db` with nested `vi.fn()` chains that mirror the exact builder shape
  (`insert().values().onConflictDoUpdate()`, `select().from().where().limit()`,
  `delete().where()`) each method calls, per the Phase 3 spec's list of 9
  named cases.
- Ran `pnpm db:migrate` against the local Neon DB **twice** in a row to
  confirm idempotency (see Gates below), then verified the live table shape
  with `psql \d ledger_receipt_files`.
- Ran `pnpm exec tsc --noEmit` and `pnpm test` (full suite, not just the new
  file) — both clean.

### Gates

- **Migration applied cleanly, confirmed idempotent (ran twice).** First run:
  `→ 0060_ledger_receipt_files.sql` followed by `✅ Migrations completed
  successfully` (all earlier migrations' `NOTICE ... already exists, skipping`
  as expected — no output specific to a failure). Second run: Postgres emitted
  `NOTICE: relation "ledger_receipt_files" already exists, skipping` and the
  run still completed with `✅ Migrations completed successfully` — no error,
  no partial state.
- **Live table shape** (`psql \d ledger_receipt_files`):
  ```
  key          | text                     | not null
  content_type | text                     | not null
  bytes        | bytea                    | not null
  byte_size    | integer                  | not null
  created_at   | timestamp with time zone | not null | now()
  Indexes: "ledger_receipt_files_pkey" PRIMARY KEY, btree (key)
  ```
  Matches `schema.ts` and the migration exactly.
- **`pnpm exec tsc --noEmit`** — clean, no errors.
- **`pnpm test`** — 459/459 passed across 15 test files (14 pre-existing +
  the new `database.test.ts`), including all 9 new
  `DatabaseReceiptStorage` tests (verified individually with `vitest run
  src/lib/receipt-storage/database.test.ts --reporter=verbose`, all 9 green).

### Outputs

- **Schema change:** `src/lib/db/schema.ts` — added `customType` to the
  `drizzle-orm/pg-core` import; appended the `bytea` customType export and the
  `ledgerReceiptFiles` table (`ledger_receipt_files`: `key text PRIMARY KEY`,
  `contentType text NOT NULL`, `bytes bytea NOT NULL`, `byteSize integer NOT
  NULL`, `createdAt timestamptz NOT NULL DEFAULT NOW()`), plus
  `LedgerReceiptFile`/`NewLedgerReceiptFile` type exports.
- **Migration:** `drizzle/migrations/0060_ledger_receipt_files.sql` — single
  idempotent `CREATE TABLE IF NOT EXISTS` statement; confirmed safe to re-run
  (ran twice locally, see Gates).
- **Tables affected:** one new table, `ledger_receipt_files`. No existing
  table touched — the two defect fixes (Flow D orphan-delete,
  `receiptBytesToBodyInit()` adoption) named in the Phase 3 design are
  route-level edits, not schema, and remain api-developer's work.
- **No role bindings / `FEATURES` seed rows** — this table is not
  permission-gated directly; access is mediated entirely through the existing
  `LEDGER_VIEW`/`LEDGER_RECORD`/ownership gates on the six consuming routes,
  unchanged by this work item (confirmed Phase 1/Phase 3, no `FEATURES`
  change).
- **New adapter:** `src/lib/receipt-storage/database.ts` —
  `DatabaseReceiptStorage implements ReceiptStorage`.
- **New tests:** `src/lib/receipt-storage/database.test.ts` — 9 unit tests, all
  green.
- **`db:push` implication:** `schema.ts` is authoritative — the next
  `drizzle-kit push --force` (part of `pnpm build`) will see
  `ledgerReceiptFiles` already matches the live table created by the
  migration (same shape), so `db:push` should be a no-op for this table. No
  drift expected.
- **Local apply command used:** `export $(grep -E "^DATABASE_URL=" .env.local
  | xargs) && pnpm db:migrate` (ran twice for the idempotency gate). Did not
  run `pnpm db:push` separately — `pnpm build:only`/`pnpm build` will run it as
  part of the normal pipeline, and the migration already brought the local DB
  to the exact shape `schema.ts` declares.

### Open questions / handoff notes

- **For api-developer (next):** `ledgerReceiptFiles` (table) and
  `DatabaseReceiptStorage` (adapter, `src/lib/receipt-storage/database.ts`,
  default-exported as a named class) are ready to consume. The adapter's
  constructor takes no arguments (`new DatabaseReceiptStorage()`), matching
  `LocalReceiptStorage`/`VercelBlobStorage`'s shape, so the factory rewrite in
  `index.ts` should be a drop-in per the Phase 3 design's exact factory-rewrite
  snippet.
- **Foreign keys / relationships:** none. `ledger_receipt_files.key` is a bare
  `text PRIMARY KEY` with no FK pointing at it and no FK it points to — it's
  referenced only indirectly, by string equality, from the
  `receiptStorageKey`/`letterStorageKey`-shaped columns on
  `ledgerTransactions`/`ledgerReimbursements`/`ledgerAcknowledgments` (those
  columns are unchanged by this work item; they still just hold the opaque
  key string, same as under Blob/Local).
- **Untouched, confirmed out of scope for this half:** `src/lib/receipt-storage/index.ts`
  (factory + doc-comment), `local.ts` (doc-comment only), `vercel-blob.ts`
  (deletion), `package.json`/`pnpm-lock.yaml` (`@vercel/blob` removal),
  `receipt-storage.test.ts` (comment update), the two defect-fix route edits
  (`transactions/[id]/route.ts`, `acknowledgments/[id]/letter/route.ts`,
  `members/reimbursements/[id]/receipt/route.ts`), and `CLAUDE.md`'s
  `BLOB_READ_WRITE_TOKEN` line — all named explicitly in the Phase 3 File List
  as api-developer's.
- No commit made — per instructions, work is left staged for review/commit by
  the user or a later step.

---

## Phase 4 — Implementation (API) — 2026-07-21

**Owner:** api-developer
**Status:** complete

### Summary

Wired `DatabaseReceiptStorage` into the `getReceiptStorage()` factory
(`NODE_ENV === "production"` selection, no env var), removed `@vercel/blob`
and its adapter outright, and applied the two pre-existing defect fixes named
by the Phase 3 design: the Flow D orphan-bytes leak on transaction
receipt remove/replace, and the byte-corruption regression guard
(`receiptBytesToBodyInit()`) on the two read routes that hadn't adopted it.
All changes match the Phase 3 design's exact method bodies/snippets — no
deviations. Typecheck, full unit suite (459/459), and the production build
are all clean.

### What I did

- Read the Phase 3 design doc in full, DECISION-040, and the four files I'd
  edit (`index.ts`, `local.ts`, `vercel-blob.ts`, `receipt-storage.test.ts`)
  plus the three route handlers touched by the two defect fixes.
- Rewrote `getReceiptStorage()` in `src/lib/receipt-storage/index.ts`:
  replaced the `BLOB_READ_WRITE_TOKEN`-presence branch with
  `process.env.NODE_ENV === "production"` → lazy `require("./database")`;
  else → lazy `require("./local")`. Removed the FU-6 `console.warn` fallback
  block entirely (no longer reachable — there is no "wrong" branch NODE_ENV
  can silently fall into). Updated the module doc-comment and the factory's
  own doc-comment to describe the NODE_ENV-based selection and cite
  DECISION-040. Kept `_resetReceiptStorageForTest()` untouched.
- Updated `local.ts`'s doc-comment: "used when BLOB_READ_WRITE_TOKEN is
  absent" → "used in local development and test (NODE_ENV !== 'production' —
  DECISION-040)".
- Deleted `src/lib/receipt-storage/vercel-blob.ts` outright.
- Ran `pnpm remove @vercel/blob` — removed from `package.json`/`pnpm-lock.yaml`.
- Grepped `src/` and `package.json` for `@vercel/blob`, `vercel-blob`, and
  `BLOB_READ_WRITE_TOKEN` before and after the edits — confirmed only the four
  files the Phase 3 File List named referenced any of these strings, and
  after the edits the only remaining hit is an intentional historical mention
  inside `index.ts`'s doc-comment (explaining why the old token-based
  selection was a footgun) — no functional reference remains anywhere.
- **Defect fix (a) — orphan-bytes:** `src/app/api/admin/ledger/transactions/[id]/route.ts`.
  Added `getReceiptStorage` to the existing `@/lib/receipt-storage` import.
  After the existing `receiptStorageKey` validation block, capture
  `oldReceiptKeyToDelete` (the previous key, only when it's actually changing
  to a different value — an idempotent resubmit of the same key must not
  delete the bytes it's pointing at). After the DB write succeeds (covers
  both the transfer-pair `db.transaction` branch and the single-row branch),
  best-effort `getReceiptStorage().delete(oldReceiptKeyToDelete)` in a
  try/catch that logs but never fails the request — matches the design's
  "delete after write" ordering (the route receives an already-uploaded key,
  so there's no upload-ordering hazard the way the acknowledgment-letter
  route has).
- **Defect fix (b) — byte-corruption guard:** in both
  `src/app/api/admin/ledger/acknowledgments/[id]/letter/route.ts` (GET) and
  `src/app/api/members/reimbursements/[id]/receipt/route.ts` (GET), added
  `receiptBytesToBodyInit` to the existing `@/lib/receipt-storage` import and
  replaced `new Response(stored.bytes.buffer as ArrayBuffer, ...)` with
  `new Response(receiptBytesToBodyInit(stored.bytes), ...)` — identical
  pattern to the two already-guarded routes
  (`transactions/[id]/receipt/route.ts`,
  `admin/ledger/reimbursements/[id]/receipt/route.ts`). Also aligned
  `Content-Length` to `stored.bytes.byteLength.toString()` (was `.length`) in
  both files per the Phase 3 design's optional consistency nit — no
  functional difference for a `Buffer`, just matches the already-guarded
  routes' style.
- Updated the "factory not directly unit-testable" comment block in
  `src/lib/receipt-storage/receipt-storage.test.ts` (~line 187) to describe
  the NODE_ENV rule instead of `BLOB_READ_WRITE_TOKEN`, and to point at
  `database.test.ts` for `DatabaseReceiptStorage` coverage — no test-logic
  changes, no new test cases (per Phase 3: 0 new tests owed by this half).
- Removed the `BLOB_READ_WRITE_TOKEN` line from CLAUDE.md's Environment
  Variables list (with its DECISION-020/DECISION-018 note) — grepped
  CLAUDE.md afterward for any other "Blob"/"BLOB" reference; none remained.
- Ran the full gate sequence: `pnpm exec tsc --noEmit` (clean), `pnpm test`
  (459/459 across 15 files, unchanged count — this half added no new tests,
  per Phase 3 spec), `pnpm build:only` (clean production build, exit 0, all
  routes including the three edited ones compiled).

### Outputs

**Files modified:**
- `src/lib/receipt-storage/index.ts` — factory rewrite (`NODE_ENV`-based
  selection replacing `BLOB_READ_WRITE_TOKEN`), module + factory doc-comments
  updated, FU-6 `console.warn` fallback removed, import swapped from
  `VercelBlobStorage` to `DatabaseReceiptStorage`. `ReceiptStorage` interface,
  `RECEIPT_KEY_REGEX`, `receiptBytesToBodyInit()`, and
  `_resetReceiptStorageForTest()` unchanged.
- `src/lib/receipt-storage/local.ts` — doc-comment only (selection-rule
  description updated; no code change).
- `src/lib/receipt-storage/receipt-storage.test.ts` — comment-only update to
  the factory-not-testable note; zero test-count change.
- `src/app/api/admin/ledger/transactions/[id]/route.ts` — PATCH handler:
  added `getReceiptStorage` import, `oldReceiptKeyToDelete` capture, and a
  post-write best-effort `delete()` call (defect fix a). Response contract
  unchanged (`{ id }` on success).
- `src/app/api/admin/ledger/acknowledgments/[id]/letter/route.ts` — GET
  handler: response body now goes through `receiptBytesToBodyInit()` (defect
  fix b). No contract change.
- `src/app/api/members/reimbursements/[id]/receipt/route.ts` — GET handler:
  response body now goes through `receiptBytesToBodyInit()` (defect fix b).
  No contract change.
- `package.json` / `pnpm-lock.yaml` — `@vercel/blob` dependency removed.
- `CLAUDE.md` — `BLOB_READ_WRITE_TOKEN` line removed from Environment
  Variables list.

**Files deleted:**
- `src/lib/receipt-storage/vercel-blob.ts`

**No new routes, no server-action signature changes, no schema changes** —
this half is exactly what Phase 3 scoped: factory rewrite, dependency
removal, two internal route-level defect fixes. All six consuming routes'
auth/`hasFeature()` gates are untouched (confirmed unchanged: `LEDGER_RECORD`
on transaction PATCH, `LEDGER_RECORD` on acknowledgment letter GET,
ownership check on member reimbursement receipt GET).

**@vercel/blob removal confirmed:** grep of `src/` and `package.json` for
`@vercel/blob`, `vercel-blob`, `BLOB_READ_WRITE_TOKEN` after all edits shows
only one hit — a historical mention inside `index.ts`'s doc-comment,
explaining why the old selection signal was a footgun (not a functional
reference).

### Gates

- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm test` — 459/459 passed across 15 test files (unchanged from
  database-admin's Phase 4 half — this half added zero new tests, per the
  Phase 3 spec's "no new tests for the two route-level defect fixes" ruling).
- `pnpm build:only` — clean production build, exit 0. All routes compiled,
  including the three edited in this half.
- No native browser dialogs introduced. No `console.log` in any edited file
  — the one new logging call (`console.error` in the orphan-delete catch
  block) matches this codebase's existing catch-and-log pattern used
  elsewhere in the same file and in the acknowledgment-letter route.

### Open questions / handoff notes

- **Next: qa (Phase 5).** Per the Phase 3 design's Edge Cases section, three
  things need explicit manual/e2e verification that no unit test covers:
  1. **Orphan-row spot-check:** attach a receipt to a transaction, then
     remove or replace it via PATCH — confirm the old
     `ledger_receipt_files` row is gone (`SELECT count(*) FROM
     ledger_receipt_files` before/after, or spot-check via the admin ledger
     UI). This exercises defect fix (a).
  2. **Byte-identical receipt view on both newly-guarded routes:** view an
     acknowledgment letter (`GET .../acknowledgments/[id]/letter`) and a
     member's own reimbursement receipt (`GET
     .../members/reimbursements/[id]/receipt`) and confirm the returned
     bytes match the uploaded file exactly — this is the regression class
     `receiptBytesToBodyInit()` exists to prevent, and it's newly reachable
     on these two routes now that the byte source is changing underneath
     them.
  3. **NODE_ENV=production exercises the DB adapter against the local DB:**
     run `pnpm build:only` (applies migrations) then `pnpm start` (or
     equivalent `next start`) and confirm a real receipt upload → view →
     delete round-trip works end-to-end against `DatabaseReceiptStorage`,
     not just the mocked unit tests. This is the first time in this
     codebase a Vitest-green/build-green feature also requires a live
     `NODE_ENV=production` run to verify its production code path, per the
     Phase 3 design's explicit callout.
- No `ux-developer` step needed — confirmed by Phase 1/2/3, this is a
  backend-only adapter swap with zero UI surface changes.
- `database.ts`/`database.test.ts` (database-admin's half) were not
  re-reviewed for correctness beyond confirming their exported shape matches
  what the factory now imports (`DatabaseReceiptStorage`, zero-arg
  constructor) — already gated by database-admin's own Phase 4 report (9/9
  tests green, migration applied and confirmed idempotent).

---

## Phase 5 — Verification — 2026-07-21

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** All four automated gates are clean (typecheck, 459/459
unit tests, production build, 29/29 relevant e2e tests). `@vercel/blob` is
fully removed from `src/`, `package.json`, and `pnpm-lock.yaml` — the one
remaining hit is the intentional historical doc-comment in `index.ts`.
Migration `0060_ledger_receipt_files.sql` is confirmed idempotent (ran twice
against the local DB) and the live table matches `schema.ts` exactly. Diff
review of every file in the Phase 4 output confirms it matches the Phase 3
design with zero deviations. Most importantly, the specific gap that let the
original bug reach production — storage never exercised against the real
backend in the right environment — is now closed: I built and started the
app in actual production mode (`NODE_ENV=production` via `next start`) and
drove `DatabaseReceiptStorage.save()` / `.read()` / `.delete()` against the
real local Postgres/Neon database through the live HTTP routes, not a mock,
with a direct `psql` row-count check before/after to prove the writes and
deletes actually happened at the DB level. See "Critical Verification"
below for the exact steps.

### What I did

1. **Read** the full work-log (Phases 1–4) and the current diff (`git status`,
   `git diff` on every modified file) to confirm the implementation matches
   what was described before running anything.
2. **Gate 1 — typecheck.** `pnpm exec tsc --noEmit` → clean, no errors.
3. **Gate 2 — unit tests.** `pnpm test` → **459/459 passed**, 15 test files,
   311ms.
4. **Gate 3 — production build.** `pnpm build:only` → clean, exit 0, all 96
   routes compiled including the three edited route handlers.
5. **`@vercel/blob` removal audit.** Grepped `src/`, `package.json`,
   `pnpm-lock.yaml` for `@vercel/blob`, `vercel-blob`, `BLOB_READ_WRITE_TOKEN`
   — zero functional hits. The only remaining string match anywhere is the
   historical footgun-explanation sentence inside `index.ts`'s module
   doc-comment (line 13), which is intentional per the Phase 4 report.
   Confirmed `src/lib/receipt-storage/vercel-blob.ts` no longer exists on
   disk. Confirmed `CLAUDE.md`'s `BLOB_READ_WRITE_TOKEN` env-var line is
   gone.
6. **Migration idempotency.** Ran
   `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`
   twice in the same session. Both runs completed with
   `✅ Migrations completed successfully`; the second (and, since
   database-admin had already applied it once in Phase 4, effectively third)
   run emitted `NOTICE: relation "ledger_receipt_files" already exists,
   skipping` for migration `0060` — no error, no partial state. Confirmed the
   live table via `psql \d ledger_receipt_files`: `key text PK`,
   `content_type text NOT NULL`, `bytes bytea NOT NULL`,
   `byte_size integer NOT NULL`, `created_at timestamptz NOT NULL DEFAULT
   now()` — matches `schema.ts` and the migration file exactly.
7. **Diff review** of every file in the Phase 4 output against the Phase 3
   design doc's exact snippets:
   - `src/lib/receipt-storage/index.ts` — factory rewrite matches verbatim:
     `NODE_ENV === "production"` branch, lazy `require("./database")`, the
     FU-6 `console.warn` fallback fully removed (no longer a reachable
     "wrong" branch), doc-comments updated, `VercelBlobStorage` import
     replaced with `DatabaseReceiptStorage`.
   - `src/lib/receipt-storage/database.ts` — `save()`/`read()`/`delete()`
     bodies match the design exactly: `save()` is
     `insert().values().onConflictDoUpdate({ target: [key], set: {...} })`
     with `createdAt` correctly omitted from `set` (first-write-wins);
     `read()` returns `{bytes, contentType}` or `null` on an empty result
     set; `delete()` is an unconditional `DELETE ... WHERE key = $1` with no
     existence check, matching the no-op-on-missing-key contract.
   - `src/lib/receipt-storage/database.test.ts` — all 9 named unit tests
     present, correctly asserting the builder-call shape and the
     `createdAt`-absent-from-`set` regression guard.
   - `src/lib/db/schema.ts` — `bytea` customType and `ledgerReceiptFiles`
     table added exactly as specified, appended at the end of the file per
     this file's established convention.
   - **Defect fix (a) — orphan-delete**
     (`src/app/api/admin/ledger/transactions/[id]/route.ts`): read the full
     surrounding context (lines 330–499), not just the diff hunks.
     `oldReceiptKeyToDelete` is captured once, correctly, only when
     `receiptStorageKey` is present in the body AND an existing key differs
     from the new value (an idempotent resubmit of the same key correctly
     yields `null` — no delete). The delete call sits **after** the
     `if (updateBoth && existing.transferGroupId) {...} else {...}` block
     that performs the actual `db.update`/`db.transaction` write — so it
     fires after **both** the transfer-pair and single-row code paths,
     confirmed by reading past the closing brace of that if/else before the
     delete block appears. It's wrapped in `try/catch` with a `console.error`
     that never rethrows — a storage-cleanup failure cannot fail the PATCH
     request. Matches the design exactly.
   - **Defect fix (b) — byte-corruption guard**
     (`acknowledgments/[id]/letter/route.ts` GET,
     `members/reimbursements/[id]/receipt/route.ts` GET): both now import and
     call `receiptBytesToBodyInit(stored.bytes)` in place of the unguarded
     `new Response(stored.bytes.buffer as ArrayBuffer, ...)`, and both align
     `Content-Length` to `.byteLength`. `receiptBytesToBodyInit()` itself
     (`Uint8Array.from(bytes)`) is unchanged — confirmed it still produces a
     freshly-allocated, non-pooled backing buffer regardless of byte source.
   - No `console.log` in any edited file (one new `console.error` in the
     orphan-delete catch block, matching the codebase's existing
     catch-and-log convention). No native browser dialogs introduced (this
     is a backend-only change; no dialogs were ever in scope).

### Critical Verification — DatabaseReceiptStorage against real Postgres

This is the specific gap the brief called out: the original production bug
existed because storage was never exercised against the real backend in the
right environment. Here is exactly how I closed it.

**1. Ran the app in actual production mode.**
```
pnpm build:only                                    # production build (already gate 3)
pnpm exec dotenv -e .env.local -- pnpm exec next start   # NODE_ENV=production, port 3000
```
Confirmed the server was up (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → `200`). Under `next start`, `NODE_ENV=production`, so `getReceiptStorage()` takes the `DatabaseReceiptStorage` branch — this is the only way to exercise that branch at all; `pnpm dev` and Vitest never touch it.

**2. Confirmed a real Postgres baseline.** `SELECT count(*) FROM
ledger_receipt_files;` → `0` before starting, and separately confirmed via
`psql \d ledger_funds` / `\d ledger_reimbursements` the exact columns needed
to construct real fixture rows through the live API (an `entityId` +
`fundId` pair for a ledger transaction; a `submitted_by_member_id` for a
reimbursement).

**3. Drove the real flow via Playwright's authenticated `page.request`**
(reusing `e2e/helpers/auth.ts`'s `signInAsAdmin`, which does a real
credentials sign-in against the running production server — this sidesteps
hand-rolling NextAuth's CSRF handshake in raw curl while still exercising
real HTTP end to end). Two temporary spec files were written, run, and then
**deleted** after verification (`e2e/_qa-db-receipt-adapter.spec.ts`,
`e2e/_qa-db-receipt-adapter-2.spec.ts` — confirmed gone via `git status`,
not part of the permanent suite):

   - **Upload → save().** `POST /api/admin/ledger/transactions/upload` with
     a real 118-byte PNG fixture (valid 8-byte PNG signature + IHDR/IDAT/IEND
     chunks, generated locally) → `200 { key }`. Direct `psql` query on
     `ledger_receipt_files` immediately after (during two earlier failed
     attempts that got as far as the upload step before a fixture-payload
     bug was fixed) showed real rows: `byte_size = 118`, `content_type =
     'image/png'` — proof `save()` wrote real bytes into `bytea`, not a mock.
   - **Create → attach key.** `POST /api/admin/ledger/transactions` with
     `receiptStorageKey` set to the uploaded key → `201 { id }`.
   - **View → read() + receiptBytesToBodyInit().**
     `GET /api/admin/ledger/transactions/[id]/receipt` → `200`, and
     `Buffer.from(await response.body()).equals(originalBytes)` → **true**.
     This is the exact regression class the byte-corruption guard exists to
     prevent, now proven end-to-end against `postgres.js`'s real `bytea`
     hex-decode path, not a unit-test mock.
   - **Orphan-delete (defect fix a).** `PATCH` the same transaction with
     `receiptStorageKey: null` → `200`. Re-fetched
     `GET .../receipt` → `404` (no receipt attached). Then, **directly
     against Postgres**, not inferring from the route's response:
     `SELECT count(*) FROM ledger_receipt_files;` → `0`, and
     `SELECT key FROM ledger_receipt_files WHERE key = '<the uploaded
     key>';` → `0 rows`. The row that `save()` created is confirmed gone
     from the database, not just unreferenced.
   - **Second byte-guard route — member reimbursement receipt.** Uploaded a
     second fixture the same way, then inserted a `ledger_reimbursements` row
     directly via `psql` (not via `POST /api/members/reimbursements` —
     that route sends a real Resend notification email to every
     `LEDGER_APPROVE` holder, confirmed live by `RESEND_API_KEY` being set in
     `.env.local`; inserting directly avoided spamming real board members
     during a QA drill). Signed-in admin was temporarily linked to a
     **throwaway synthetic member row** (`qa-verification-throwaway-2@example.invalid`,
     not a real club member) so the ownership check
     (`submittedByMemberId === session.user.memberId`) would pass. Called
     `GET /api/members/reimbursements/[id]/receipt` → `200`,
     byte-identical to the original upload — confirming the *other*
     newly-guarded route also works against real DB-sourced bytes.
   - **Acknowledgment-letter route:** not driven end-to-end (creating a
     `ledger_acknowledgments` row requires a donor + gift-transaction
     acknowledgment trigger flow that would have meaningfully expanded the
     blast radius of test fixtures). Its GET handler is byte-for-byte the
     same two-line change as the member-reimbursement route
     (`receiptBytesToBodyInit(stored.bytes)` against the same
     `DatabaseReceiptStorage.read()` return value) — already proven correct
     by the member-reimbursement check above. Flagging this as the one piece
     of the "view both newly-fixed routes" ask I substituted with a
     code-identity argument rather than a live HTTP call; if a stricter bar
     is wanted, the fixture cost is a donor row + a `ledger_transactions` row
     with `donorId` set + whatever acknowledgment-creation trigger exists.

**4. Full cleanup, verified.** Deleted every row created during verification
(`ledger_receipt_files`, the QA `ledger_transactions` row, the QA
`ledger_reimbursements` row, the throwaway `members` row) and unlinked the
e2e admin user's `member_id` back to `NULL`. Confirmed via `psql` after
cleanup: `ledger_receipt_files` count `0`, no `members` rows matching
`qa-verification%`, e2e admin user's `member_id` is `NULL` again (its
original state). Killed both the production server (`next start`) and,
after the separate `pnpm test:e2e` run below, the dev server. `git status`
after cleanup shows no stray files — the two temporary spec files were
deleted.

### End-to-End Tests (standard suite, dev server)

Separately from the production-mode drill above, ran the full existing
Playwright suite against `pnpm dev` (the way `pnpm test:e2e` is meant to be
run) to confirm nothing in the existing suite regressed:

`pnpm test:e2e`: **PASS**
Total: 30 | Passed: 29 | Failed: 0 | Skipped: 1
Duration: 37.5s

No flake encountered (the known `recurring-signup-rollup` shared-fixture
flake mentioned in the brief did not trip this run — all three
`recurring-signup-rollup.spec.ts` tests passed cleanly).

### Regression Tests Added

None added to the permanent suite for this work item. Per the Phase 3
design's explicit ruling (confirmed correct by this review): the two
route-level defect fixes are not unit-testable in this codebase's existing
Vitest style (no test currently mocks a route handler over HTTP), and the
`bytea` wire round-trip is not unit-testable at all without a real Postgres
connection — QA's manual/e2e drill against the real DB (above) is the
verification for both, by design. The 9 `database.test.ts` unit tests
(already delivered by database-admin in Phase 4, all confirmed passing here)
are the correct-altitude regression guard for the adapter's call-shape
contract (upsert semantics, `createdAt` omission, no-op-on-missing-key).

**Open gap, flagged rather than silently accepted:** there is no
*permanent, automated* guard against the exact bug class named in this
work-log's intent — "storage adapter selection silently wrong in
production." The `NODE_ENV`-based selection is structurally safer than the
`BLOB_READ_WRITE_TOKEN` regime it replaced (can't be forgotten), but nothing
in CI runs the app under `next start` and exercises a live route. This
Phase 5 drill was manual/one-off. Recommend a backlog item (tech-lead or
deployment-engineer's call) for a lightweight CI step that builds, starts in
production mode, and hits one receipt route — so this class of bug gets an
automated tripwire, not just a strengthened footgun.

### Coverage on Critical Modules

- `src/lib/receipt-storage/database.ts` — 9/9 methods and branches
  exercised by `database.test.ts` (save/read/delete, upsert `set` shape,
  `createdAt` omission, `Uint8Array`→`Buffer` coercion, empty-result `null`,
  no-op delete). Not part of the qa-agent's named coverage-target list
  (`events.ts`/`permissions.ts`/`members.ts`), so no numeric percentage
  claimed — confirming via the Phase 4 report's `vitest run
  src/lib/receipt-storage/database.test.ts --reporter=verbose` (9/9 green)
  is the applicable bar here.
- `src/lib/events.ts` / `src/lib/permissions.ts` / `src/lib/members.ts` —
  untouched by this work item; no coverage drift introduced. (Due for the
  next 7-day test-coverage sweep on its own cadence, not re-run here since
  this feature didn't touch any of the three.)

### Feature-Gate Audit (mandatory before PASS)

No new protected routes or server actions were added. Three existing routes
had internal (non-auth) line-level edits; confirmed all pre-existing gates
are still present and unchanged by reading each file directly (not inferred
from passing tests):

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `PATCH /api/admin/ledger/transactions/[id]` | yes (line 126) | yes (line 130) | `FEATURES.LEDGER_RECORD` — correct: this is a mutation (edit/attach/remove receipt), edit-level key |
| `GET /api/admin/ledger/acknowledgments/[id]/letter` | yes (line 49) | yes (line 54) | `FEATURES.LEDGER_RECORD` — unchanged from before this work item; the acknowledgment letter contains donor PII, and `LEDGER_RECORD` (not a broader view-only key) is the pre-existing, un-touched gate — also returns 403 not 404 on missing ack id as an enumeration guard, confirmed unchanged |
| `GET /api/members/reimbursements/[id]/receipt` | yes (line 28) | n/a — ownership check, correct pattern for member-owned data | ownership: `session.user.memberId` compared against `reimb.submittedByMemberId` (line 40) — correct, this is member-owned data, not admin-role-gated data |
| `POST /api/admin/ledger/transactions/upload` (unmodified, consumed by the verification drill) | yes | yes | `FEATURES.LEDGER_RECORD` — unchanged, not touched by this work item, confirmed still present |
| `GET /api/admin/ledger/transactions/[id]/receipt` (unmodified, consumed by the verification drill) | yes | yes | `FEATURES.LEDGER_VIEW` — broader read-only key than `LEDGER_RECORD`, correctly scoped for a view-only receipt fetch; unchanged |

No `FEATURES.*` key changed by this work item. No route returns bulk PII as
a *new* capability — the acknowledgment-letter and reimbursement-receipt
routes both already existed with these exact gates before this change; this
work item only altered how the bytes are read from storage.

### Minor findings (non-blocking, not gating PASS)

- **Stale doc comments (pre-existing, not in this work item's file list):**
  `src/app/api/admin/ledger/transactions/upload/route.ts` line 99 and
  `src/app/api/members/reimbursements/upload/route.ts` line 89 both still
  say `// In production: writes to Vercel Blob` — now inaccurate (writes to
  Postgres). Neither file was in the Phase 3 File List (only the *read*
  routes needed the byte-guard fix; the *upload* routes' `save()` call sites
  were correctly left untouched since `getReceiptStorage()` abstracts the
  backend). Cosmetic only — recommend a one-line comment fix next time
  either file is touched.
- **Design-doc factual slip (does not affect this verdict):** the Phase 3
  design doc's Edge Cases section states "`pnpm build:only` runs `pnpm
  db:migrate` first." Checked `package.json` directly: `build:only` does
  **not** run migrations (only the full `build` script does:
  `db:migrate && drizzle-kit push --force && next build`). This did not
  cause a problem in this verification because database-admin had already
  applied migration `0060` locally in Phase 4, and I re-ran `db:migrate`
  explicitly before the production-mode drill per the brief's own
  instructions (independent of the design doc's incorrect claim) — but
  future QA agents relying on that sentence to be true when a *fresh* clone
  runs `build:only` without ever having run `db:migrate` would hit a missing
  table. Worth a one-line correction in the design doc's Edge Cases section
  if this pattern (build:only + fresh clone + no prior migrate) ever
  actually happens in practice.

### Verdict: PASS

All four gates green (typecheck, 459/459 unit tests, production build,
29/29 relevant e2e tests). `@vercel/blob` fully removed. Migration confirmed
idempotent against the live local DB. Every file in the Phase 4 diff matches
the Phase 3 design with no deviations found on direct read. Both
pre-existing defects (orphan-bytes, byte-corruption guard gap) are fixed
correctly, confirmed by reading the surrounding code, not just the diff
hunks. The specific gap that let the original bug reach production —
storage never exercised against the real backend in the right environment —
is closed: `DatabaseReceiptStorage.save()`/`.read()`/`.delete()` were driven
against real local Postgres under actual `NODE_ENV=production`, with direct
`psql` row-count verification (not route-response inference) proving the
orphan-delete fix removes the correct row. Feature-gate audit confirms no
regression on any of the five routes reviewed. No blocking findings — two
non-blocking documentation nits noted above for a future pass.

### Outputs

- `docs/work-log/2026-07-21-receipt-storage-in-database.md` — this Phase 5
  section; status table row updated to `complete` / `PASS`.
- No source files modified by this phase — verification only. Two temporary
  Playwright spec files (`e2e/_qa-db-receipt-adapter.spec.ts`,
  `e2e/_qa-db-receipt-adapter-2.spec.ts`) were created, run, and deleted;
  confirmed absent from `git status` at the end of this phase.
- All QA-created database rows deleted; e2e admin user's `member_id`
  restored to `NULL`. No lasting data changes to the local DB beyond the
  already-applied (and already-idempotent) migration `0060`.

### Open questions / handoff notes

- **Next: analyst (Phase 6).** Shipped-vs-intent review — the intent was
  "move receipt bytes off Vercel Blob into Postgres because
  `BLOB_READ_WRITE_TOKEN` was unset in production and broke all receipt
  uploads." That's exactly what shipped, verified end-to-end against real
  Postgres in real production mode above.
- **Backlog candidate (not blocking, noted above):** no CI-level automated
  guard exists for "adapter selection silently wrong in production" as a
  *class* — today's protection is structural (`NODE_ENV` can't be forgotten
  the way an env var could) plus this one-time manual Phase 5 drill. If the
  club wants a standing tripwire, a CI step that does `build:only` → `next
  start` → hit one receipt route would close that gap permanently. Tech-lead
  or deployment-engineer's call on priority.
- **Doc nits (not blocking):** the two stale "writes to Vercel Blob"
  comments and the Phase 3 design doc's incorrect `build:only`-runs-migrations
  claim, both detailed above — fix opportunistically, not urgent enough to
  loop back to Phase 3/4 for.
- **Acknowledgment-letter route byte-guard fix was verified by code-identity
  argument, not a live HTTP call** (see Critical Verification above for the
  specific reason — avoiding a donor/gift-acknowledgment fixture chain). If
  analyst or the user wants that closed with an actual HTTP round-trip
  before Phase 6 signs off, flag it back to qa and I'll build the donor +
  acknowledgment fixture chain.

---

## Phase 6 — Shipped vs Intent — 2026-07-21

**Owner:** analyst
**Status:** complete

### Summary

The shipped feature delivers exactly what the intent doc asked for: receipt
bytes now live in Postgres (`ledger_receipt_files`), selected via
`NODE_ENV === "production"`, and `@vercel/blob` is gone outright. I re-read
my own Phase 1 review, then walked every flow, gap, and open question I
raised against what QA actually verified (not just what the diff claims).
The specific failure the user hit in production — `fs.writeFileSync` on
Vercel's read-only function filesystem — is structurally impossible now,
because the production code path never touches the filesystem at all; it
was proven end-to-end against real Postgres under real `NODE_ENV=production`,
with `psql` row counts (not route-response inference) confirming writes and
deletes actually happened. Three small, non-blocking items remain open —
none of them touch the fix itself.

**Verdict: SHIP WITH NOTES**

### What I did

- Re-read my Phase 1 review (all 8 gaps, both open questions) in full.
- Read the architect's Phase 2 rulings (adapter-selection signal, table
  design, defect-bundling), the Phase 3 design doc's exact method bodies and
  defect-fix diffs, both Phase 4 reports (database-admin, api-developer),
  and QA's Phase 5 report in full, including the "Critical Verification"
  section's exact `psql`-backed proof steps and the Minor Findings.
- Walked each of my 8 Phase 1 gaps and 2 open questions against what
  actually shipped and what QA actually exercised (see Intent-vs-shipped
  diff below) — not just trusting the "matches" claims in later phases'
  summaries.
- Specifically assessed the four questions in the brief: (1) whether this
  fixes the real production failure, (2) whether `NODE_ENV` selection is
  robust for Vercel Preview, (3) whether the two folded-in defect fixes are
  genuinely complete, (4) whether the one QA verification gap
  (acknowledgment-letter byte-guard via code-identity, not live HTTP) is
  acceptable.

### (1) Does this fix the user's actual production failure?

Yes, and it fixes it structurally, not just empirically. The root cause was
never "wrong bytes" or "wrong storage" — it was a **write to a read-only
filesystem** (`LocalReceiptStorage`'s `fs.writeFileSync` running because
`BLOB_READ_WRITE_TOKEN` was unset). `DatabaseReceiptStorage` never calls any
filesystem API; it writes to Postgres over the connection pool that's
already open for every other query on every request. So on Vercel
production, the exact operation that threw (`fs.writeFileSync` on a
read-only function container) is no longer in the call path at all — there
is no filesystem write to fail. QA didn't just reason about this: it ran the
app under actual `next start` (`NODE_ENV=production`), drove a real upload
through the live HTTP route, and confirmed via direct `psql` queries
(`byte_size = 118`, `content_type = 'image/png'`) that real bytes landed in
`ledger_receipt_files` — the closest verification possible short of an
actual Vercel deploy. This is a genuine fix, not a workaround that shifts
the failure elsewhere.

### (2) Is the `NODE_ENV` selection robust for Vercel Preview deployments?

Yes. Vercel sets `NODE_ENV=production` for both Production and Preview
deployment builds and runtimes — only `next dev` (local) sets
`NODE_ENV=development`. The architect's Phase 2 ruling states this
explicitly ("covering both Vercel Production *and* Preview deployments —
both share `DATABASE_URL`; neither has a writable FS") and it holds: a
Preview deploy will select `DatabaseReceiptStorage` and write to whatever
Postgres database `DATABASE_URL` resolves to in that environment (same Neon
project, unless Vercel's preview-branch DB provisioning is configured
differently — that's a Neon/Vercel environment-variable concern outside
this feature's scope, not a gap in the selection logic itself). This closes
the exact class of gap that caused the original bug: an admin-configured
value that can be silently forgotten. `NODE_ENV` cannot be.

### (3) Are the two folded-in defect fixes genuinely complete?

**Orphan-delete (defect a):** yes, complete for the flow it targets. My
Phase 1 gap 2 named exactly one gap — Flow D (`PATCH
.../transactions/[id]`, `receiptStorageKey` set to `null` or a new value)
never called `delete()` on the old key. QA didn't just review the diff; it
drove the flow live and queried Postgres directly before/after
(`SELECT count(*) FROM ledger_receipt_files` → `0`, and a key-specific
`SELECT` → `0 rows`) to confirm the orphaned row is actually gone from the
database, not just unreferenced from the transaction row. I checked whether
any other flow has the same shape of gap (a receipt reference nulled
without a corresponding `delete()`) — the acknowledgment-letter route
already had the correct delete-before-save pattern pre-existing (my Phase 1
review confirmed this), and no reimbursement flow removes a receipt without
replacing the whole reimbursement row. Flow D was the only instance; it's
fixed and proven.

**Byte-corruption guard (defect b):** functionally complete — all four read
routes now call `receiptBytesToBodyInit()` — but verification is 3-of-4
live, 1-of-4 by code-identity argument (see item 4 below). I don't consider
this "incomplete" as a defect fix; the code change itself is uniform and
correct across all four routes. It's a QA-coverage gap, not a
shipped-code gap, and I've evaluated it as such.

### (4) Is the acknowledgment-letter QA gap acceptable?

Acceptable, not a blocker. The unverified route
(`acknowledgments/[id]/letter` GET) runs the exact same two-line pattern
(`receiptBytesToBodyInit(stored.bytes)` against
`DatabaseReceiptStorage.read()`) already proven byte-identical on two other
routes reading from the same table via the same adapter method. There is no
route-specific logic in that two-line diff that could diverge from the
already-verified behavior — the only way it could fail differently is if
Postgres's `bytea` decode behaved differently depending on *which route*
called `read()`, which isn't a real failure mode. QA's own reasoning for
skipping it (avoiding building a donor + gift-acknowledgment fixture chain
just to prove an already-proven two-line pattern a third time) is sound
engineering judgment, not corner-cutting. I'm logging it as a tracked
follow-up rather than silently accepting it, per the pipeline's "confirm or
flag" standard, but it does not block ship.

### What's working

- The core fix is real and directly verified against the actual failure
  mode, not just against a test double — QA's decision to run `next start`
  in real production mode and query Postgres directly (rather than trusting
  route responses) is exactly the rigor this bug needed, since the original
  defect only manifested under real production conditions in the first
  place.
- The `NODE_ENV`-based selection genuinely closes the "silently forgotten
  config" bug class this whole feature exists to fix, and does so for
  Preview as well as Production without any additional configuration.
- Both defect fixes I flagged in Phase 1 (orphan-bytes, byte-guard gap) were
  picked up in-scope by the architect rather than deferred, and both are now
  fixed on the exact files/lines I named.
- Permission gates are unchanged and QA re-confirmed each one by reading the
  route bodies directly (not inferring from tests) — `LEDGER_RECORD` /
  `LEDGER_VIEW` / ownership checks are all intact.

### Intent-vs-shipped diff

- Phase 1 said the adapter-selection signal was "the load-bearing decision
  the whole feature hinges on" and flagged the risk of DB-always-everywhere
  killing the zero-config dev experience. Shipped: `NODE_ENV === "production"`
  selects `DatabaseReceiptStorage`; anything else keeps `LocalReceiptStorage`
  and the `.receipt-store/` dev experience unchanged. **Matches** — this is
  exactly the outcome my gap 1 and open question recommended.
- Phase 1 said the orphan-bytes gap (Flow D) "gets materially worse,
  unbounded, forever" once bytes move into Postgres and should be fixed in
  this work item, not deferred. Shipped: fixed, delete-after-write,
  best-effort with catch-and-log, verified via direct `psql` row count.
  **Matches.**
- Phase 1 said the byte-corruption guard gap (2 of 4 read routes unguarded)
  is "exactly when this bug class resurfaces" and should be fixed here.
  Shipped: all 4 routes guarded; 3 of 4 verified live against real Postgres
  bytes, 1 of 4 (acknowledgment letter) verified by code-identity argument
  only. **Acceptable drift** — the code fix is complete, only the
  verification depth differs, and the reasoning for the shallower
  verification on that one route is sound (see item 4 above).
- Phase 1 said no `FEATURES` change was needed and all six routes' gates
  should stay exactly as they are. Shipped: zero `FEATURES` changes;
  QA's Feature-Gate Audit table re-confirms all five routes it touched
  still have their original, correct gate. **Matches.**
- Phase 1 said the interface contract (`save()` upsert, `read()`
  null-on-missing, `delete()` no-op-on-missing) must hold for a DB adapter
  to be a true drop-in. Shipped and unit-tested (9/9 green) exactly per
  that contract, including the `createdAt`-omitted-on-conflict detail from
  the architect's suggestion. **Matches.**
- Phase 1 (out-of-scope, user-confirmed) said no data migration was needed.
  Shipped: none performed, none needed. **Matches.**
- Not named in Phase 1, discovered downstream: two stale doc comments
  ("writes to Vercel Blob") in the two *upload* routes, and one factual
  slip in the Phase 3 design doc claiming `build:only` runs migrations
  (it doesn't — only the full `build` script does, and that's what actually
  runs on a real Vercel deploy per this project's build pipeline, so this
  slip carries no production risk). Both are QA-flagged, non-blocking,
  cosmetic/documentation-only items outside anything I asked about in
  Phase 1.

### Edge cases

- **Empty state:** not applicable — infra swap, zero new UI, confirmed no
  pages/components in the file list at any phase.
- **Failure microcopy:** pass. The generic 500 ("Failed to upload receipt")
  the user originally hit is now unreachable via its original cause (the
  read-only-FS write no longer exists in the production path); the same
  generic copy remains correctly in place for genuine DB errors, which is
  the right level of specificity for a true infrastructure failure.
- **Permission gate:** pass. Unchanged on all six consuming routes;
  QA's Feature-Gate Audit table re-verified by direct code read, not test
  inference.
- **Mobile:** not applicable — no UI surface.

### Follow-ups (SHIP WITH NOTES)

1. **Close the acknowledgment-letter byte-guard verification gap with a live
   HTTP round-trip**, not just the code-identity argument. Low priority —
   the code path is provably identical to two already-verified routes — but
   it's the one item in this work that was asserted rather than measured.
   Owner: qa, whenever a donor + gift-acknowledgment fixture chain is next
   convenient to stand up (e.g., piggyback on other Ledger/acknowledgment
   test work rather than a dedicated pass).
2. **Fix the two stale "writes to Vercel Blob" doc comments** in
   `src/app/api/admin/ledger/transactions/upload/route.ts` (line ~99) and
   `src/app/api/members/reimbursements/upload/route.ts` (line ~89) — both
   now inaccurate. Owner: api-developer, opportunistic (next time either
   file is touched, or a quick standalone one-line-per-file fix).
3. **Correct the Phase 3 design doc's factual slip** that `pnpm build:only`
   runs `pnpm db:migrate` (it does not — only the full `build` script does).
   No production risk today since Vercel's actual deploy uses `build`, not
   `build:only`, but the incorrect sentence could mislead a future
   contributor relying on `build:only` after a fresh clone with no prior
   `db:migrate` run. Owner: tech-lead, one-line edit to this work-log's
   Phase 3 section or a note in `CLAUDE.md` if the ambiguity recurs
   elsewhere.
4. **Backlog candidate, not a defect:** no CI step exercises the app under
   real `NODE_ENV=production` against a live route. Today's protection
   against "storage adapter silently wrong in production" is structural
   (`NODE_ENV` can't be forgotten) plus this one-time manual QA drill. If
   the club wants a standing automated tripwire for this class of bug,
   that's a new backlog item — tech-lead/deployment-engineer's call on
   priority, not something this feature needs to ship.

### Outputs

- `docs/work-log/2026-07-21-receipt-storage-in-database.md` — this Phase 6
  section; status table row updated to `complete` / `SHIP WITH NOTES` /
  `2026-07-21`. This closes the work-log's pipeline tracking for this
  feature (`SHIP WITH NOTES` ships; the four items above become the
  tracked follow-ups per the pipeline's own rule).

### Open questions / handoff notes

- None blocking. If the user wants follow-up 1 (ack-letter live HTTP
  verification) closed before considering this fully done rather than
  deferred, say so and I'll route it back to qa — QA already scoped the
  fixture cost in its own Phase 5 report.
- Follow-ups 2 and 3 are one-line, low-risk, opportunistic fixes — no need
  to spin up a dedicated work-log entry unless the user wants one tracked
  separately.
- Follow-up 4 is a genuine new-feature idea (CI production-mode tripwire),
  not part of this work item's scope — route it to `docs/backlog.md` with a
  `B-nn` ID if the user wants it captured formally.

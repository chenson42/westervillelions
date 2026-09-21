# Donor Link on a Reconciled Transaction — Work Log

> **Slug:** `2026-09-21-reconciled-donor-link-carveout`
> **Surface:** (dashboard) admin — The Ledger (`/api/admin/ledger/transactions/[id]`)
> **Permission(s):** Existing `LEDGER_RECORD` covers this — no new key.
> **Estimated complexity:** small
> **Pipeline mode:** Full
> **Note:** This is one of two asks from the originating request. The other (a
> sub-$250 donor worklist) is a separate ticket and out of scope here.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (recap below, reconstructed from the Phase 2 handoff brief — see note) | READY WITH NOTES | 2026-09-21 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-09-21 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-09-21 |
| 4 — Implementation | database-admin (schema, complete) → api-developer (routes/tests, complete) | Complete | — | 2026-09-21 |
| 5 — Verification | qa | Complete | PASS | 2026-09-21 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-21 |

---

# Phase 1 — Functional Refinement (analyst) — 2026-09-21

**Note on this section:** no Phase 1 work-log file existed when Phase 2 began.
This recap is reconstructed from the brief handed to the architect, which
quoted Phase 1's verdict and position directly. It is not a substitute for
analyst's full five-pass review — if that fuller record exists elsewhere, it
should be merged in here; otherwise treat this recap as the record.

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

The Treasurer cannot link a donor to a transaction that a closed
reconciliation session has already cleared — `PATCH
/api/admin/ledger/transactions/[id]` 403s the request before it even parses
the body, because the reconciled-row lock (DECISION-036) is a blanket "any
field" lock with no override.

## The Bug

`src/app/api/admin/ledger/transactions/[id]/route.ts` (~line 185, pre-fix)
returns a 403 — "This transaction was cleared by a closed reconciliation
session — reopen it to edit or delete this row" — for **any** PATCH against a
row with `reconciledSessionId` set, checked before `await request.json()`.
The Treasurer's only recourse today is to reopen the entire closed session
just to attach a donor, which re-exposes every other row in that session to
edits it doesn't need.

## Phase 1's Position (persuasive, not self-adopted)

A `donorId`-only carve-out is defensible because a donor link changes no
number the tie-out depends on — but it is a change to DECISION-036's explicit
"any field" scope and the user's hard-tie-out-with-no-override decision, not
a bug fix within it, and therefore needs an explicit amending decision-log
entry with architect sign-off, not a quiet code change that leaves the
decision log describing behavior the code no longer has. Phase 1 declined to
adopt this position unilaterally and escalated the ruling to Phase 2.

## Constraints Named by Phase 1's Adversarial Pass

- Field bundling must be rejected outright — a PATCH body containing
  `donorId` alongside any arithmetic-affecting field
  (`amountCents`/`txnDate`/`flow`/`categoryId`/`bankAccountId`/`checkNumber`)
  must fail the whole request, checked server-side, after body parsing.
- Scope is `donorId` only — not `memo`, not `publicNote`, not
  `beneficiaryCause`, and explicitly not `categoryId` (compliance/990-adjacent,
  treated as arithmetic-adjacent).
- The DELETE route's reconciled lock stays untouched — donor unlinking is
  `PATCH { donorId: null }`, never a delete.
- The guard currently short-circuits before body parsing; any restructuring
  must not accidentally weaken the `approvedAt` immutability guard sitting
  alongside it.

## Also Flagged for Phase 2

- `ledgerAuditLog` is scoped specifically to category-management actions
  (`action` enum `category_renamed|category_merged|...`, FK
  `target_category_id`) — writing donor-link-on-reconciled-row events there
  would misuse that table's contract. Whether an audit trail is required at
  all, and where it lives if so, was left to Phase 2.
- Whether "which fields are arithmetic-affecting" deserves a named, testable
  helper rather than being reasoned about inline in the route, given CLAUDE.md
  treats the same decision implemented in more than two places as a
  correctness finding.

## Permissions

Existing `LEDGER_RECORD` gate on the PATCH route is unchanged and sufficient
— this changes what a `LEDGER_RECORD` holder may submit to an already-gated
route, not who may reach it.

---

# Phase 2 — Architectural Review (architect) — 2026-09-21

**Owner:** architect
**Status:** complete

## Summary

**Approved with suggestions.** A `donorId`-only carve-out on the
reconciled-row lock is a legitimate refinement of DECISION-036's intent, not
a contradiction of it — the User Decision behind the "any field" lock was
about refusing a soft escape hatch for **arithmetic**, and `donorId` cannot
touch that arithmetic. Logged as **DECISION-099**, amending DECISION-036 item
4 only (items 1–3 and 5–10 stand unchanged). I revised Phase 1's proposed
mechanism from a denylist of six named arithmetic-affecting fields to a
strict allowlist of exactly one field (`donorId`) — safer by construction and
simpler to enforce. An audit trail is ruled **required**, not optional, and
must not be bolted onto `ledgerAuditLog`'s category-scoped contract.

## What I did

- Read `docs/decisions.md` DECISION-036 in full (all 10 items + rationale),
  and the parent work-log `docs/work-log/2026-07-21-ledger-reconciliation-sessions.md`
  Phase 3 section (API contract, data model, immutability-lock edge-case
  writeup, "harder lock chosen because... hard tie-out with no
  discrepancy-note escape hatch") to confirm exactly what the User Decision
  the lock protects actually covers.
- Read `src/app/api/admin/ledger/transactions/[id]/route.ts` in full — both
  PATCH and DELETE — to confirm the guard ordering (`approvedAt` → `rejected`
  → `reconciledSessionId`, all before `await request.json()`), and to confirm
  a `donorId` handling block already exists in the route (lines ~437–461,
  from inc6a) that the carve-out would simply need to become reachable for.
- Read `src/lib/db/schema.ts`'s `ledgerAuditLog` table definition to confirm
  Phase 1's claim that its `action` enum and `target_category_id` FK are
  category-scoped — confirmed; every existing consumer of that table filters
  on `target_category_id`.
- Read `src/components/admin/ledger/link-donor-dialog.tsx` to check whether
  the real client ever bundles other fields into a donor-link PATCH — it
  doesn't; it sends `{ donorId }` or `{ donorId: null }` exclusively, and
  already surfaces the server's `error` string via toast on failure. This
  rules out any UI change being needed for the fix itself.
- Searched `docs/decisions.md` for this project's existing convention for
  superseding/amending a prior decision, to match rather than invent a
  format: found the "Amends: DECISION-NNN" field (DECISION-014 amending
  DECISION-013's Impact bullet, with DECISION-013's Status line updated in
  place) and the "Superseded in part by DECISION-MMM (item N only — the rest
  unaffected)" pattern (DECISION-067 partially superseding DECISION-066).
  Followed both: DECISION-099 uses "Amends: DECISION-036 — item 4 only," and
  DECISION-036's Status line is updated in place to point forward.

## Ruling

1. **Legitimate refinement, not a contradiction.** DECISION-036 item 4's own
   rationale text is explicit about what it protects: "...silently degrading
   a closed session's arithmetic via an unflagged edit would contradict that
   decision's spirit." The User Decision itself (parent work-log, 2026-07-21)
   was about refusing a soft escape hatch for arithmetic — it could not have
   contemplated donor metadata, because `donorId` didn't exist on
   `ledgerTransactions` until a later increment (inc6a). `donorId` is read by
   nothing in `computeTieOut()`, the overlap/gap validators, or close/reopen.
   The "any field" wording was tech-lead's implementation default at a time
   no narrower carve-out had been considered — an implementation-level
   choice, not the User Decision restated. Narrowing it to a field that
   provably cannot enter the arithmetic keeps the actual guarantee (a closed
   session's numbers never move without reopening) fully intact.
2. **Amending entry: DECISION-099, "Amends: DECISION-036 — item 4 only."**
   Logged in `docs/decisions.md` (inserted above DECISION-098, following
   newest-first ordering). DECISION-036's own Status line is updated in
   place: "Resolved (item 4 narrowed by DECISION-099 — a strictly-allowlisted
   `donorId`-only carve-out on the PATCH route; items 1, 2, 3, and 5–10 below
   are unaffected and still stand)." This matches the two existing precedents
   in this file exactly rather than inventing new conventions.
3. **Revision to Phase 1's proposed mechanism: allowlist, not denylist.**
   Phase 1's "reject if `donorId` appears alongside any of the six named
   arithmetic-affecting fields" is **not adopted as specified**. Implement
   instead as: the request body's key set must be exactly `{ donorId }` — no
   other field name may appear at all, arithmetic-affecting or not. A
   denylist has to be remembered and extended every time a new
   arithmetic-adjacent column is added to `ledgerTransactions` in the future
   — a maintenance burden with a silent failure mode if forgotten. An
   allowlist of one field cannot make that mistake: anything that isn't
   literally `donorId` is refused by construction, permanently, with nothing
   to keep in sync. This also automatically satisfies Phase 1's separate
   "not `memo`, not `publicNote`, not `beneficiaryCause`" rule without a
   second list.

## Constraints Confirmed / Refined

- **Field bundling rejected outright:** confirmed, but reshaped from a
  denylist to an allowlist (see Ruling #3). Enforced server-side, after body
  parsing.
- **Scope is `donorId` only:** confirmed as specified; falls out for free
  from the allowlist.
- **DELETE route untouched:** confirmed — no change needed or made.
- **`approvedAt` guard must not weaken:** confirmed and hardened further —
  see "Guard Restructuring" below. `approvedAt` and `status === 'rejected'`
  stay unconditional, full locks, evaluated before `await request.json()`,
  as two guards textually separate from the (now conditional)
  `reconciledSessionId` guard. Do not consolidate the three into one shared
  "immutability" function — that would put the carve-out one accidental edit
  away from silently reaching approved or rejected rows too, which protect
  different invariants (board-approval finality; audit-trail-on-rejection)
  this ticket never touched.

## Guard Restructuring (for tech-lead/api-developer)

Only the `reconciledSessionId` guard moves to after `await request.json()`.
New shape:

```
auth() + hasFeature(LEDGER_RECORD)
fetch existing row
if (existing.approvedAt) → 403                          // unchanged, unconditional
if (existing.status === 'rejected') → 403                // unchanged, unconditional
body = await request.json()
if (existing.reconciledSessionId) {
  if (!isWithinReconciledLockCarveout(body)) → 403 (existing message, verbatim)
  // else: fall through — the existing donorId-handling block (~line 437)
  // already validates and applies the donor link/unlink.
}
... rest of PATCH validation/handling, unchanged
```

## Placement

- **New named helper, not inline field-checking:** `src/lib/ledger.ts` (the
  existing pure-function module for ledger business logic — no DB, no
  Next.js import, mirroring `reconciliation.ts`'s established role) gains
  `RECONCILED_LOCK_CARVEOUT_FIELDS = ["donorId"] as const` and
  `isWithinReconciledLockCarveout(body: Record<string, unknown>): boolean`.
  Unit-tested in `ledger.test.ts` alongside this codebase's existing
  pure-function suite. The route calls it once. This directly answers Phase
  1's question: yes, this decision deserves a named, testable helper — a
  field-classification rule is exactly the kind of thing CLAUDE.md's
  duplication rule warns gets silently copy-pasted the next time a similar
  carve-out is written.

## Audit Trail — REQUIRED, not nice-to-have

This is a deliberate, narrow hole in an otherwise-hard financial-integrity
lock. This codebase already attributes every other action that reaches
inside a closed or otherwise-locked financial record — DECISION-035's
receipt-waiver actor/reason/timestamp trio, session close/reopen's
`closedByUserId`/`reopenedByUserId` — so skipping attribution here would be
the one unexplained exception on this exact surface, not a new bar being
invented.

**Do not extend `ledgerAuditLog` as it exists today.** Its `action` enum and
`target_category_id` FK are contractually category-scoped, and every
existing reader filters on `target_category_id` — repurposing it for an
unrelated target would misuse the table's contract, exactly as Phase 1
flagged.

**Recommended shape (database-admin/tech-lead to finalize in Phase 3):**
generalize `ledgerAuditLog` into the Ledger surface's one audit sink — add a
nullable `targetTransactionId` FK alongside the existing `targetCategoryId`
(app-layer invariant: exactly one target non-null per row), and extend the
`action` value set with the new donor-link-on-reconciled-row events. This
keeps exactly one audit table for the whole Ledger surface rather than a
new, near-identical sibling — directly in the spirit of CLAUDE.md's
duplication finding — and every existing category-audit reader is
unaffected (an added nullable column, and action values it will never
match).

**Acceptable cheaper fallback** if Phase 3 finds the polymorphic-FK shape too
invasive: a last-state-only trio of columns directly on `ledgerTransactions`
(mirroring the existing `reopenedAt`/`reopenedByUserId` precedent). This is
weaker — it loses history across repeated edits and reintroduces the
single-purpose-column clutter `ledgerAuditLog` was originally split out to
avoid — so it should be a fallback, not the default choice.

**This requires a schema change either way — database-admin must be in the
Phase 4 implementation chain.**

## Open Question for Phase 3 (not resolved here)

The PATCH route's `?both=true` transfer-pair path independently 403s if the
**partner** leg has `reconciledSessionId` set (route lines ~578–586 today).
Phase 1's scope never considered transfer pairs, and the real
`link-donor-dialog.tsx` client never sends `?both=true` on a donor-only
edit — so this branch is very unlikely to be reachable in practice — but
tech-lead must confirm in Phase 3 rather than have it silently inherit or
silently miss the carve-out.

## UI / Component Impact

**None identified.** `src/components/admin/ledger/link-donor-dialog.tsx`
already PATCHes `{ donorId }` / `{ donorId: null }` exclusively (never
bundled with other fields) and already surfaces the server's `error` string
verbatim via `toast.error(data.error)`. The fix is server-only. Flagging for
tech-lead to confirm in Phase 3 rather than assuming — if some other
donor-link entry point exists that bundles fields, it would need a small
ux-developer change to stop doing so.

## Permissions

No new `FEATURES` key. `LEDGER_RECORD` already gates this route; this
changes what a `LEDGER_RECORD` holder may submit, not who may reach the
route.

## Migration Numbering

Any migration for the audit-trail schema change is a placeholder number
until Phase 4 — database-admin re-derives the real next-free number via
`ls drizzle/migrations/*.sql | sort | tail -3` at implementation time, per
this project's standing rule.

## Outputs

- `docs/decisions.md` — new **DECISION-099** (amends DECISION-036 item 4;
  allowlist mechanism; audit-trail requirement and recommended shape; helper
  placement) inserted above DECISION-098. DECISION-036's Status line updated
  in place to point forward to DECISION-099.
- `docs/work-log/2026-09-21-reconciled-donor-link-carveout.md` — this file
  (created; Phase 1 recap + Phase 2 review).
- No code changed in this phase (architectural review only, per this
  project's Phase 2 boundary — no implementation).

## Open questions / handoff notes

- Phase 3 (tech-lead) must: (1) finalize the audit-trail shape (polymorphic
  `ledgerAuditLog` FK vs. the columns-on-`ledgerTransactions` fallback) and
  write the concrete migration/schema diff for database-admin to implement;
  (2) resolve the `?both=true` transfer-pair open question above; (3)
  confirm no other donor-link entry point needs a UI change; (4) name the
  exact `isWithinReconciledLockCarveout()` signature and its unit tests
  (mirroring this codebase's named-test-list convention, e.g. in
  `ledger.test.ts`).
- Implementer chain for Phase 4: **database-admin** first (audit-trail schema
  + idempotent migration), then **api-developer** (`ledger.ts` helper +
  route restructuring + audit-write call). No ux-developer scope identified;
  tech-lead should confirm this in Phase 3 rather than have it silently
  assumed.
- Gate for Phase 4: the three guards (`approvedAt`, `rejected`,
  `reconciledSessionId`) must remain textually separate in the route, not
  merged; the carve-out check must be the named `ledger.ts` helper, not
  inline; and the field-bundling rejection must be allowlist-based per
  Ruling #3, not the denylist Phase 1 originally proposed.

---

# Phase 3 — Technical Design (tech-lead) — 2026-09-21

**Owner:** tech-lead
**Status:** complete

## Summary

Two entry points write `ledgerTransactions.donorId`: the standalone `PATCH
/api/admin/ledger/transactions/[id]` (used by `LinkDonorDialog`) and `POST
.../transactions/[id]/acknowledge` (used when an acknowledgment is created
with a donor already picked). The PATCH route blanket-403s the first path on
a reconciled row; the acknowledge route has **no reconciled check at all**
today and silently writes `donorId` regardless — a real gap, found while
tracing every donor-link writer per this ticket's ask. This design closes
both: PATCH gets the allowlisted `donorId`-only carve-out DECISION-099
specifies, and the acknowledge route gets an audit write on the same
condition (it never needed a lock — it already never touches arithmetic —
but it was writing into a locked row unattributed). Both routes share one
pure helper (`isWithinReconciledLockCarveout` — PATCH only, since the
acknowledge route's body shape isn't caller-controlled the same way) and one
audit action constant, so the two paths can't drift again. The audit trail
is a new nullable `targetTransactionId` column generalizing the existing
`ledgerAuditLog` table — its own migration comment (`0074_ledger_category_audit.sql`)
already earmarked this exact column as a planned future addition. The
transfer-pair `?both=true` branch is resolved by simply never entering it for
a carve-out-shaped edit, regardless of the query param, because a donor is
proven (by reading the existing code) to never propagate to a transfer
partner anyway.

## What I did

- Read the full Phase 1 recap and Phase 2 ruling in this work-log, plus
  DECISION-099 (the amending entry) and DECISION-036 item 4 (the lock it
  narrows) in `docs/decisions.md`.
- Read `src/app/api/admin/ledger/transactions/[id]/route.ts` in full (778
  lines) — both PATCH and DELETE — including the existing `donorId` handling
  block (~437–461), the `?both=true` transfer-pair block (~552–637), and the
  DELETE route's untouched reconciled lock (~718–759).
- Read `src/lib/db/schema.ts`'s `ledgerAuditLog` definition (~762–786) and
  its origin migration `drizzle/migrations/0074_ledger_category_audit.sql`.
  The migration's own header comment says `target_category_id` is "one of
  several typed target-FK columns this table is expected to grow
  (**target_transaction_id**, target_budget_id — additive, future, out of
  scope here) — mirrors permission_audit_log's shape." This is exactly the
  column Phase 2 recommended adding — the table was designed for this from
  day one, which resolves the audit-trail open question in favor of the
  polymorphic sink, not the fallback.
- Grepped every reader and writer of `ledgerAuditLog` (`ledger-category-queries.ts`,
  `ledger-acknowledgment-letter-queries.ts`). Found there is **no read-back
  UI for this table at all today** — it's write-only (no admin page queries
  it back). This is a lower-risk finding than Phase 2's "every existing
  reader filters `WHERE target_category_id = ...`" — there are zero readers
  to break, only two writers, both already tolerant of `targetCategoryId:
  null` (`ledger-acknowledgment-letter-queries.ts:267` already writes a row
  with `targetCategoryId: null` for `ack_letter_template_updated`, proving
  the nullable-target pattern is already live, not hypothetical).
  `action` has no DB `CHECK` constraint — confirmed in the same migration
  comment ("No DB CHECK on `action` — this codebase doesn't use enum/CHECK
  constraints for these classifier columns anywhere") — so adding a new
  action value needs zero migration, only documentation.
- Read `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts` in
  full per the ticket's explicit call-out. **Finding, not speculation:**
  its POST handler fetches the transaction (no `reconciledSessionId` read at
  all, no guard), and unconditionally does
  `tx.update(ledgerTransactions).set({ donorId, updatedAt: new Date() })`
  (~line 297-300) whenever `donorId` is provided in the request body —
  regardless of the transaction's `reconciledSessionId`, `approvedAt`, or
  `status`. It **bypasses the lock entirely**, today, in production. It
  cannot touch arithmetic (the route's body shape is fixed by its own code —
  `donorId`, `typeOverride`, `quidProQuoValueCents`, `quidProQuoDescription`,
  `purpose`; `amountCents` is explicitly copied server-side from the
  transaction row, never accepted from the request body, per the route's own
  docstring), so this is not a tie-out risk — but it is an unattributed,
  inconsistent bypass of the exact invariant this ticket is otherwise adding
  a narrow, audited hole in. Two entry points writing the same field with
  diverged guard behavior is the kind of drift CLAUDE.md's duplication rule
  flags, applied to a guard instead of a helper function.
- Grepped every component that can PATCH a transaction's `donorId` or reach
  the acknowledge route with one:
  `src/components/admin/ledger/link-donor-dialog.tsx` (confirmed —
  exclusively `{ donorId }` / `{ donorId: null }`, PATCH route only),
  `src/components/admin/ledger/txn-donor-actions.tsx` (a button wrapper
  around `LinkDonorDialog`, no independent fetch),
  `src/app/(dashboard)/admin/ledger/donors/[id]/donor-detail-client.tsx`
  (renders the same `LinkDonorDialog`; its own `fetch` calls are
  donor-record `DELETE` only, nothing that touches transactions). No
  additional UI entry point exists. Confirms Phase 2's finding and closes
  the ticket's third open question — the only server-side gap is the
  acknowledge route, and it needs no UI change (the create-acknowledgment
  dialog already always could target a reconciled transaction; the fix is
  entirely server-side attribution).
- Read `src/app/api/admin/ledger/transactions/[id]/route.test.ts` and
  `.../acknowledge/route.test.ts` to confirm this codebase's existing test
  file/describe/it naming convention for this route (mock-`db` style,
  `describe("PATCH .../[id] — <topic>")`) so Phase 4's new tests slot in
  rather than inventing a new convention.

## Permissions

No new `FEATURES` key, confirmed. `LEDGER_RECORD` already gates both routes
touched here (PATCH `.../[id]` and POST `.../[id]/acknowledge`). This design
changes what a `LEDGER_RECORD` holder may submit / what effect an existing
call has, not who may reach either route.

## API Contract

### `PATCH /api/admin/ledger/transactions/[id]` (unchanged shape, changed guard)

No change to the request/response shape documented in the route's existing
header comment. The only externally visible behavior change: a request whose
body's key set is **exactly `{ donorId }`** (value a valid donor id string,
or `null` to unlink) now succeeds (200, `{ id }`) against a row with
`reconciledSessionId` set, instead of 403ing. Any other body shape against
such a row still 403s with the existing verbatim message. `approvedAt` and
`status === 'rejected'` rows still 403 unconditionally regardless of body
shape — the carve-out never applies to those two guards.

### `POST /api/admin/ledger/transactions/[id]/acknowledge` (no shape change, new side effect)

No change to request/response shape. New side effect: when this route's
existing unconditional `donorId` write to `ledgerTransactions` fires
(`donorId` truthy in the body) **and** the transaction's `reconciledSessionId`
is set, an audit row is now written in the same `db.transaction()` as the
donor-id update. The write itself is not gated further — it already never
touches arithmetic, so there is nothing to lock. This is documentation +
attribution only, not a behavior restriction.

## Data Model

### `ledgerAuditLog` gains one nullable column (no other tables touched)

```ts
// src/lib/db/schema.ts — ledgerAuditLog, inserted alongside targetCategoryId
targetTransactionId: uuid("target_transaction_id")
  .references(() => ledgerTransactions.id, { onDelete: "set null" }),
```

Placement note for database-admin: `ledgerAuditLog` (line ~762) is declared
*before* `ledgerTransactions` (line ~840) in `schema.ts`. This is fine as-is
— Drizzle's `.references(() => table.column)` takes a callback specifically
to support forward references within the same file; no reordering needed.
Mirrors the existing `targetCategoryId` column exactly (same nullable FK
shape, same `ON DELETE SET NULL`).

App-layer invariant carried over from Phase 2, unchanged: on any given row,
exactly one of `targetCategoryId` / `targetTransactionId` is non-null (or, in
the one existing case — `ack_letter_template_updated` — both are null; that
precedent already exists and is undisturbed).

New action value (no schema/migration impact — `action` is a `CHECK`-free
`text` column, confirmed above): `donor_linked_on_reconciled_transaction`.
One constant, one string, used by both write sites (PATCH route and
acknowledge route) so the two can never drift to different names for the
same event. Covers both link and unlink — distinguished by reading `before`/
`after`, not by a second action name.

### Migration

New file, number **0102** — placeholder; database-admin must re-derive the
real next-free number via `ls drizzle/migrations/*.sql | sort | tail -3` at
implementation time (current tip is `0101_drop_stale_board_position.sql`),
per this project's standing rule.

```sql
-- 0102_ledger_audit_log_transaction_target.sql
-- Generalizes ledger_audit_log into the Ledger surface's one audit sink by
-- adding the target_transaction_id column its origin migration
-- (0074_ledger_category_audit.sql) already earmarked as a planned future
-- addition. Backs DECISION-099's required audit trail for a donor link
-- written on a reconciled-lock transaction (docs/work-log/
-- 2026-09-21-reconciled-donor-link-carveout.md).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ledger_audit_log' AND column_name = 'target_transaction_id'
  ) THEN
    ALTER TABLE ledger_audit_log
      ADD COLUMN target_transaction_id UUID REFERENCES ledger_transactions(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'ix_ledger_audit_log_transaction'
  ) THEN
    CREATE INDEX ix_ledger_audit_log_transaction ON ledger_audit_log (target_transaction_id);
  END IF;
END $$;
```

Idempotency: both blocks are guarded (`information_schema.columns` /
`pg_indexes` existence checks), safe to replay on every deploy per CLAUDE.md.
No existing row is touched; every existing `ledgerAuditLog` reader query
(there are none that read this table back today, confirmed above) is
unaffected either way.

### Audit row shape (written by both call sites, same constant)

```ts
// src/lib/ledger.ts — pure constant, no DB import
export const RECONCILED_DONOR_LINK_AUDIT_ACTION = "donor_linked_on_reconciled_transaction" as const;
```

Row written (inline `tx.insert(ledgerAuditLog).values(...)` at each call
site — two call sites is not the duplication CLAUDE.md's rule targets, but
the action-name string and the row *shape* must not drift, hence the shared
constant):

```ts
{
  actorUserId: session.user.id,
  action: RECONCILED_DONOR_LINK_AUDIT_ACTION,
  targetTransactionId: id, // the transaction id, not the acknowledgment id
  before: JSON.stringify({ donorId: existing.donorId }),
  after: JSON.stringify({ donorId: update.donorId ?? null }),
  details:
    `Reconciled-lock carve-out: transaction was cleared by session ${existing.reconciledSessionId}.`,
    // acknowledge route appends " (donor linked via acknowledgment creation)."
}
```

Answers the ticket's explicit question: actor, transaction, old donor, new
donor, and timestamp (`createdAt`, default) are all recorded, and `details`
names the reconciliation session the row was locked by at the time — not
just a boolean, the actual session id, which is more useful for a treasurer
reconstructing what happened later.

**When the audit row is written, precisely:** only when the write reaches a
row that IS locked (`existing.reconciledSessionId` truthy at write time).
An ordinary donor-link edit on a non-reconciled row writes no audit row —
this is a hole-specific attribution trail, not a general donor-link audit
log; adding one for every ordinary edit was not asked for and would be
scope creep against Phase 2's "narrow" framing.

## Component / Page Plan

No pages or components created or modified. Confirmed above: no UI entry
point bundles fields into a donor-link PATCH, and the acknowledge route's
fix is entirely server-side. **No ux-developer scope in this ticket.**

Files to modify:
- `src/lib/db/schema.ts` — `ledgerAuditLog.targetTransactionId` (database-admin)
- `drizzle/migrations/0102_ledger_audit_log_transaction_target.sql` (new, database-admin)
- `src/lib/ledger.ts` — `RECONCILED_LOCK_CARVEOUT_FIELDS`,
  `isWithinReconciledLockCarveout()`, `RECONCILED_DONOR_LINK_AUDIT_ACTION` (api-developer)
- `src/lib/ledger.test.ts` — new tests for the helper (api-developer)
- `src/app/api/admin/ledger/transactions/[id]/route.ts` — PATCH only:
  guard restructuring + transfer-pair branch condition + audit write (api-developer)
- `src/app/api/admin/ledger/transactions/[id]/route.test.ts` — new tests (api-developer)
- `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts` — audit
  write on the existing unconditional `donorId` write (api-developer)
- `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.test.ts` — new tests (api-developer)

## Implementation Order

1. **Schema (database-admin).** Add `targetTransactionId` to
   `ledgerAuditLog` in `schema.ts`; write migration `0102_...sql` (idempotent,
   number re-derived at implementation time). Confirm `pnpm db:push` and a
   local `pnpm db:migrate` succeed with no drop of existing data.
2. **Permissions.** None — skip.
3. **API routes (api-developer).**
   a. `src/lib/ledger.ts`: add `RECONCILED_LOCK_CARVEOUT_FIELDS`,
      `isWithinReconciledLockCarveout()`, `RECONCILED_DONOR_LINK_AUDIT_ACTION`.
   b. PATCH route restructuring (see Guard Restructuring below).
   c. Acknowledge route: add the conditional audit write next to the
      existing `donorId` update, inside the same `db.transaction()`.
   d. Unit tests named below, all passing.
4. **UI.** None.
5. **Email notifications.** None — this ticket has no email surface.
6. **Release notes entry.** Written by tech-lead at merge time per CLAUDE.md
   — deferred to Phase 6.

### Guard Restructuring — PATCH route (confirms and finalizes Phase 2's sketch)

```
auth() + hasFeature(LEDGER_RECORD)
fetch existing row
if (existing.approvedAt) → 403                                    // unchanged, unconditional, untouched
if (existing.status === 'rejected') → 403                         // unchanged, unconditional, untouched
body = await request.json()
const carveout = existing.reconciledSessionId
  ? isWithinReconciledLockCarveout(body)
  : false;
if (existing.reconciledSessionId && !carveout) → 403 (existing message, verbatim)
// else: fall through — existing donorId-handling block (~437-461) validates/applies it
... rest of validation unchanged ...

// Transfer-pair branch condition gains one clause:
if (updateBoth && existing.transferGroupId && !carveout) {
  ... existing partner-fetch, partner.approvedAt/reconciledSessionId guards,
      symmetric update — entirely unchanged code ...
} else if (donorLinkChanged) {
  ... existing single-row donor-link branch — gains the audit write, see below ...
} else {
  ... existing plain single-row update ...
}
```

Two textually distinct changes, not a merge of the three guards (Phase 2's
explicit requirement, honored): (1) the `reconciledSessionId` guard alone
becomes conditional; (2) the transfer-pair branch condition gains
`&& !carveout`. `approvedAt` and `rejected` remain byte-for-byte what they
are today.

**Audit write placement:** inside the existing `donorLinkChanged` branch's
`db.transaction()` (both the `?both=true` and the non-`?both` copies of that
block currently exist as two near-identical `db.transaction()` calls —
~line 612 and ~line 621). Add the audit insert to **both**, guarded on
`carveout` (only true when the row was actually locked) — i.e. `if
(carveout) { await tx.insert(ledgerAuditLog).values({...}); }`. Since
`carveout` is only ever `true` when `existing.reconciledSessionId` was set,
this cannot fire for an everyday non-reconciled donor-link edit.

### Resolution: `?both=true` transfer-pair open question

**Decided:** a carve-out-shaped edit (body key set exactly `{ donorId }`,
row reconciled) never enters the transfer-pair branch, regardless of the
`?both` query parameter — it always takes the single-row path. This is not
new client-facing behavior for the real UI (which never sends `?both=true`
on a donor edit), and it changes nothing for a **non-reconciled** row's
`?both=true` + `donorId` request (out of scope — that path is unmodified by
this ticket, `!carveout` is always `true` there since `carveout` can only be
`true` on a reconciled row per its own definition).

**Why this is correct, verified by reading the existing code, not assumed:**
the transfer-pair branch's `symmetricUpdate` object only ever copies
`amountCents`, `txnDate`, and `memo` from `update` (~line 595-597) — `donorId`
is never included, by design (a donor is a fact about one leg of a transfer,
not a symmetric property of the pair, exactly as `bankAccountId` is already
documented as per-leg-immutable in this same route's header comment,
DECISION-058). The `donorLinkChanged` block inside the transfer-pair branch
(~line 612-617) already only ever updates `ledgerAcknowledgments` keyed on
`donationTxnId = id` — the **requested** row, never `partnerId`. So a donor
link **already never touches the partner row today**, with or without this
ticket. The only thing `?both=true` currently contributes to a donor-only
edit is: fetching the partner row and enforcing the partner's own
`approvedAt`/`reconciledSessionId` locks *for no reason*, since nothing about
the partner is being written. Skipping the branch entirely for a carve-out
edit removes a guard that was blocking a write that was never going to
happen — it does not weaken anything, because the partner's `approvedAt`
guard (a different invariant, board-approval finality) was never protecting
a real write in this specific case either. **A donor link is, and remains,
meaningless for a transfer partner leg — this makes that explicit in code
instead of leaving it an accidental side effect of unrelated field
propagation.**

## Edge Cases & Risks

- **Empty body `{}` against a reconciled row.** `isWithinReconciledLockCarveout({})`
  is `false` (key set length 0 ≠ 1) → 403, same as today. No regression;
  matches the allowlist spec literally ("key set must be exactly `{ donorId }`").
- **Typo'd key (`donorID` instead of `donorId`).** Falls outside the
  allowlist → 403 with the existing reconciled-lock message, not a silent
  no-op and not a 400 — this is indistinguishable from "any other field" per
  the allowlist's fail-safe-by-construction design. Explicit unit test below.
- **`donorId` bundled with a non-arithmetic field (`memo`, `publicNote`).**
  Still rejected — the allowlist has no notion of "arithmetic-affecting,"
  which is exactly Phase 2's point (Ruling #3): this can't be gamed by
  picking a field that "seems" safe.
  a real security boundary is unaffected by whether that assumption is later
  proven wrong for some other field — the allowlist doesn't reason about
  *why* a field is safe, only that `donorId` provably is.
- **Acknowledge route's donor write on a `rejected` or non-`posted` status
  row.** Out of scope for this ticket to newly restrict — this route
  already has its own independent validation (`flow === 'income'`,
  `donationsDeductible`, no existing ack) that doesn't check `status` today
  either; changing that is a separate, unrelated hardening question this
  ticket did not raise and should not quietly bundle in.
- **Race: session closes between the PATCH guard check and the write.**
  Pre-existing risk shape (identical to the `approvedAt` guard's own
  read-then-write gap), not introduced or worsened by this change — no new
  handling needed.
- **`ON DELETE SET NULL` on `targetTransactionId`.** If a reconciled
  transaction is later hard-deleted (deletion is blocked while reconciled,
  but the row could be deleted after a reopen), its audit rows survive with
  `targetTransactionId` null and `before`/`after` still carrying the donor
  ids as text — matches `targetCategoryId`'s existing behavior on category
  deletion, not a new pattern.

## Out of Scope

- The sub-$250 donor-worklist ask (separate ticket, per this work-log's
  header note).
- Any change to the acknowledge route's own creation guards (income-only,
  Foundation-only, no-duplicate-ack) — untouched.
- Any change to DELETE, `approvedAt`, or `rejected` guards anywhere in
  either route.
- A general-purpose donor-link audit log for non-reconciled edits — only the
  exceptional (locked-row) case is audited, per Phase 2's "narrow hole"
  framing.
- Making the acknowledge route respect `approvedAt`/`rejected`/reconciled as
  a true 403 lock — it never had one, doesn't need one (it can't touch
  arithmetic), and adding one now would be an unrelated, unasked-for
  hardening of a route this ticket only needed to *attribute*, not restrict.

## Unit Tests Required (Phase 4 delivers these, not qa)

### `src/lib/ledger.test.ts` — `isWithinReconciledLockCarveout`

1. `{ donorId: "some-uuid" }` → `true`
2. `{ donorId: null }` → `true` (unlink case)
3. `{ donorId: "some-uuid", amountCents: 500 }` → `false` (arithmetic field bundled)
4. `{ donorId: "some-uuid", memo: "note" }` → `false` (non-arithmetic field bundled — proves allowlist, not denylist)
5. `{ categoryId: "some-uuid" }` → `false` (no `donorId` at all)
6. `{}` → `false` (empty body)
7. `{ donorID: "some-uuid" }` → `false` (typo'd key name, case-sensitivity guard)

### `src/app/api/admin/ledger/transactions/[id]/route.test.ts` — new `describe` block

8. A reconciled row: `PATCH { donorId: "<valid donor>" }` → 200, `donorId` updated.
9. A reconciled row: `PATCH { donorId: null }` → 200, `donorId` cleared (unlink).
10. A reconciled row: `PATCH { donorId: "<valid donor>", amountCents: 100 }` → 403, existing reconciled-lock message, `donorId` NOT updated (whole request fails).
11. A reconciled row: `PATCH { categoryId: "<id>" }` → 403 (unrelated field alone, still blocked).
12. An **approved** row (`approvedAt` set, `reconciledSessionId` also set): `PATCH { donorId: "<valid donor>" }` → 403 "Approved transactions cannot be edited" — carve-out never reached, approvedAt guard fires first.
13. A **rejected** row (`status: 'rejected'`, `reconciledSessionId` also set): `PATCH { donorId: "<valid donor>" }` → 403 "Rejected transactions cannot be edited."
14. A reconciled row: successful `PATCH { donorId: ... }` writes exactly one `ledgerAuditLog` row with `action: RECONCILED_DONOR_LINK_AUDIT_ACTION`, `targetTransactionId` = the row id, `before`/`after` reflecting the donor change, `details` naming the reconciliation session id.
15. A **non-reconciled** row: `PATCH { donorId: "<valid donor>" }` → 200, unchanged from today's behavior, and **no** `ledgerAuditLog` row written.
16. A reconciled row that is also a transfer leg (`transferGroupId` set) whose **partner** row is reconciled too: `PATCH { donorId: "<valid donor>" }?both=true` → 200 (not the partner's 403) — proves the transfer-pair branch is skipped for a carve-out edit and the partner is never queried/blocked. Assert the partner row is not touched/re-fetched (or that its own `reconciledSessionId` never enters the response).
17. Regression: a **non-reconciled** transfer leg, `PATCH { amountCents: ..., donorId: ... }?both=true` — existing behavior unchanged (still 403s if this bundles unrelated fields at all in real use, but included here only to confirm the new `&& !carveout` clause doesn't alter any existing passing test in this file).

### `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.test.ts` — extend existing suite

18. `POST` with `donorId` against a transaction whose `reconciledSessionId` is set → still succeeds (200/201, matches today's undocumented-but-real behavior) **and** now writes one `ledgerAuditLog` row (`action: RECONCILED_DONOR_LINK_AUDIT_ACTION`, `targetTransactionId`, `details` noting "via acknowledgment creation").
19. `POST` without `donorId` against a reconciled transaction → succeeds, `donorId` untouched, **no** audit row (no donor write occurred at all).
20. `POST` with `donorId` against a **non-reconciled** transaction → succeeds, unchanged from today, **no** audit row (regression — the exceptional-case-only audit rule applies here too).

## Implementer Chain for Phase 4

**database-admin** first — schema + migration (item 1 above) — then
**api-developer** — helper, PATCH route restructuring, acknowledge route
audit write, and all 20 named tests (items 3–4 above). **No ux-developer
scope**: confirmed above, no component is created or modified.

## Open questions / handoff notes

- Use the **database-admin** agent first for the schema change
  (`targetTransactionId` on `ledgerAuditLog`) and its idempotent migration.
- Then use the **api-developer** agent for: `src/lib/ledger.ts`'s new helper
  and constant, the PATCH route's guard restructuring (per the exact diff
  sketch above), the acknowledge route's new audit write, and all 20 named
  unit tests.
- Flag for api-developer specifically: the acknowledge-route finding (item
  "What I did," fourth bullet) is a genuine pre-existing bypass, not
  something this ticket introduces — implement its fix (the audit write) as
  specified, but do not expand it into adding a new 403 lock on that route;
  that would be unscoped hardening this design doc explicitly declines (see
  Out of Scope).
- No architectural or functional loop-back identified — proceed straight to
  Phase 4.

---

## Phase 4 — Implementation (schema) — 2026-09-21

**Owner:** database-admin
**Status:** complete

### Summary

Added the nullable `targetTransactionId` column to `ledgerAuditLog` exactly
as Phase 3 specified — generalizing the table into the Ledger surface's one
audit sink, per its own origin migration's earmark. Migration `0102_ledger_audit_log_transaction_target.sql`
is idempotent (verified by running it twice against the dev DB) and touches
nothing else. `schema.ts` and the live dev DB now agree, and no existing
`ledgerAuditLog` row, reader, or writer is affected.

### What I did

- Re-derived the next-free migration number per CLAUDE.md's "pick the number
  at the start of Phase 4" rule: `ls drizzle/migrations/*.sql | sort | tail -3`
  showed `0101_drop_stale_board_position.sql` as the tip (uncommitted, from
  the concurrent stale-board-position effort) — confirmed `0102` is free, as
  the Phase 3 design doc's placeholder already anticipated.
- Verified the design's premises rather than trusting them: read
  `drizzle/migrations/0074_ledger_category_audit.sql` and confirmed its
  header comment does earmark `target_transaction_id` as a planned additive
  column; read `src/lib/db/schema.ts`'s `ledgerAuditLog` block (schema.ts
  line ~762) and confirmed `ledgerTransactions` is declared later in the
  same file (line ~840), so the forward `.references(() => ledgerTransactions.id)`
  callback needs no reordering; grepped both existing writers
  (`ledger-category-queries.ts`, `ledger-acknowledgment-letter-queries.ts`)
  and confirmed neither sets `targetTransactionId`, so the new nullable
  column requires no change to either insert.
- Added `targetTransactionId: uuid("target_transaction_id").references(() => ledgerTransactions.id, { onDelete: "set null" })`
  to `ledgerAuditLog` in `src/lib/db/schema.ts`, alongside the existing
  `targetCategoryId` column, with an inline comment recording the
  ON DELETE SET NULL rationale (below) and the app-layer
  exactly-one-target invariant. Added a matching `index("ix_ledger_audit_log_transaction")`.
  This is purely additive — I did not touch the `boardPosition` removal or
  any other uncommitted change already in `schema.ts` from the concurrent
  password-reset / stale-board-position efforts.
- Wrote `drizzle/migrations/0102_ledger_audit_log_transaction_target.sql`
  matching the design doc's SQL verbatim: two `DO $$ ... END $$` blocks, one
  guarded by `information_schema.columns` for the `ALTER TABLE ... ADD COLUMN`,
  one guarded by `pg_indexes` for the `CREATE INDEX`.
- Ran `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`
  against the dev DB **twice**. First run applied the column and index
  (confirmed by the migration completing with no errors, `0102_...sql` listed
  in the run). Second run replayed cleanly with no errors on the `0102` step
  — the guards correctly no-op on replay.
- Queried the dev DB directly (via the `postgres` driver already used by
  `drizzle/run-migrations.mjs`) after both runs to verify ground truth rather
  than trusting the migration runner's silence: `target_transaction_id` is
  `uuid`, nullable; `ix_ledger_audit_log_transaction` exists; the FK
  constraint `ledger_audit_log_target_transaction_id_fkey` is
  `FOREIGN KEY (target_transaction_id) REFERENCES ledger_transactions(id) ON DELETE SET NULL`;
  and `ledger_audit_log` still holds all 631 pre-existing rows, untouched.
- Ran `pnpm exec tsc --noEmit` (clean) and `pnpm test` (108 files / 1987
  tests, all passing) after the schema change — confirms the existing
  category-audit write path (`ledger-category-queries.ts`,
  `ledger-acknowledgment-letter-queries.ts`) still compiles and its tests
  still pass with the new nullable column present.

### `onDelete` reasoning

`onDelete: "set null"`, mirroring `targetCategoryId` exactly. An audit row's
entire purpose is to survive its subject — cascading the delete would let a
transaction deletion silently erase the very record of who linked a donor to
it and when, which is the opposite of what DECISION-099 item 7 asked for
("an audit trail is REQUIRED for approval, not a nice-to-have"). `set null`
detaches the row from a deleted transaction while keeping `before`/`after`
(which hold the donor ids as text, not live FK lookups) fully legible. This
also matches the one real deletion path that can reach a row with
`targetTransactionId` set: a reconciled transaction can only be deleted after
its session is reopened (per DECISION-036), so the audit row from the
carve-out edit made while it *was* reconciled is exactly the record you'd
want to keep post-deletion.

### Outputs

- Schema change: `/Users/cshenso/git/westervillelions/src/lib/db/schema.ts`
  — `ledgerAuditLog` gains `targetTransactionId` (nullable, FK →
  `ledgerTransactions.id`, `onDelete: "set null"`) and index
  `ix_ledger_audit_log_transaction`. No other table touched.
- Migration: `/Users/cshenso/git/westervillelions/drizzle/migrations/0102_ledger_audit_log_transaction_target.sql`.
  Both statements are idempotent (`information_schema.columns` /
  `pg_indexes` guarded `DO $$` blocks) — verified safe to replay by running
  `pnpm db:migrate` twice against dev with no errors on either run.
- Table affected: `ledger_audit_log` only (one new nullable column, one new
  index). No role bindings or seed rows — this ticket has no `FEATURES`
  change, confirmed by both Phase 2 and Phase 3.
- Local apply command used: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`
  (schema.ts and the migration now agree, so `pnpm db:push` was not
  separately required to reach the verified DB state, but api-developer or
  qa running `pnpm build:only` later will invoke both `db:migrate` and
  `db:push --force` per the standard build pipeline — no drift expected
  since the two already match).
- Gates: `pnpm exec tsc --noEmit` clean; `pnpm test` — 108 files, 1987 tests,
  all passing.

### Open questions / handoff notes

- `ledgerAuditLog.targetTransactionId` is now available to api-developer:
  `uuid`, nullable, FK to `ledgerTransactions.id`, `onDelete: "set null"`.
  Insert shape per Phase 3's design doc:
  `{ actorUserId, action: RECONCILED_DONOR_LINK_AUDIT_ACTION, targetTransactionId: id, before, after, details }`
  — `targetCategoryId` should be left unset/`null` on these new rows (the
  app-layer invariant is exactly one of the two target columns non-null per
  row).
- Next agent: **api-developer**, per the Phase 3 implementer chain — add
  `RECONCILED_LOCK_CARVEOUT_FIELDS`, `isWithinReconciledLockCarveout()`, and
  `RECONCILED_DONOR_LINK_AUDIT_ACTION` to `src/lib/ledger.ts`; restructure
  the PATCH route's `reconciledSessionId` guard; add the acknowledge route's
  new audit write; write all 20 unit tests named in Phase 3. Nothing in
  schema/migration scope blocks that work — the column, FK, and index all
  exist and are confirmed live in the dev DB.
- No `db:push` schema drift risk identified: `schema.ts` was edited first,
  the migration mirrors it exactly, and both were verified together against
  the same dev DB.

---

## Phase 4 — Implementation (API) — 2026-09-21

**Owner:** api-developer
**Status:** complete

### Summary

Added the Phase 3-specified helper/constant pair to `src/lib/ledger.ts`,
restructured the PATCH route's `reconciledSessionId` guard into the narrow,
allowlisted carve-out, added the transfer-pair branch's `&& !carveout`
clause, and added the acknowledge route's attributed audit write on its
pre-existing (unguarded) donor write. All 20 named unit tests from the
Phase 3 design are written and passing, across `ledger.test.ts` and both
routes' test files. `pnpm exec tsc --noEmit`, `pnpm test` (2007/2007 passing,
up from 1987), and `pnpm build:only` all pass clean. No schema changes made
in this phase — database-admin's `targetTransactionId` column and index were
already live in dev.

### What I did

- Read the full Phase 3 design doc (this file) end to end — API contract,
  data model, guard-restructuring diff sketch, the `?both=true` resolution,
  and all 20 named tests — before touching any code, per this ticket's
  explicit instruction not to redo database-admin's schema work.
- Read `docs/decisions.md` DECISION-099 (the amending entry, allowlist
  ruling, audit-trail requirement) and DECISION-036 item 4 (the lock it
  narrows) to confirm the exact wording the 403 message and guard ordering
  must preserve verbatim.
- Read `src/lib/ledger.ts` in full to find the right placement for the new
  helper (immediately after `deriveAckType`, before `countAgedPublicFunds`)
  and to confirm the module's existing style (pure functions, no DB import,
  JSDoc explaining the "why" ahead of the "what").
- Read both route files (`.../transactions/[id]/route.ts` and
  `.../transactions/[id]/acknowledge/route.ts`) in full, and their existing
  test files, to match this codebase's established hermetic-mock pattern
  (`vi.mock("@/lib/db", ...)` with a `mockDbState` object) rather than
  inventing a new one. Confirmed via `src/lib/ledger-category-queries.test.ts`
  that importing `@/lib/db/schema` directly (real, unmocked) into a test file
  for table-reference identity is an established, safe pattern in this
  codebase — schema.ts touches no DB connection at import time (only
  `src/lib/db/index.ts` does).
- Implemented `RECONCILED_LOCK_CARVEOUT_FIELDS`, `isWithinReconciledLockCarveout()`,
  and `RECONCILED_DONOR_LINK_AUDIT_ACTION` in `src/lib/ledger.ts` — the
  allowlist check is `Object.keys(body).length === 1 && keys.includes("donorId")`,
  which fails closed on every case named in the design (bundled fields,
  missing donorId, empty body, typo'd key name).
- Restructured the PATCH route exactly per the Phase 3 diff sketch: moved
  only the `reconciledSessionId` guard to after `await request.json()`;
  `approvedAt` and `status === 'rejected'` were NOT touched and remain
  byte-for-byte unconditional, evaluated before body parsing, textually
  separate from the (now conditional) reconciled guard — verified by reading
  the diff back, not just by intent. Added `const carveout = existing.reconciledSessionId ? isWithinReconciledLockCarveout(body) : false;`
  and the `!carveout` clause on both the guard's `if` and the transfer-pair
  branch's `if (updateBoth && existing.transferGroupId && ...)`.
- Added the audit write to BOTH `donorLinkChanged` blocks (the transfer-pair
  branch's copy and the standalone branch's copy) per the design's explicit
  instruction, even though the transfer-pair branch's own `!carveout` entry
  condition makes its copy structurally unreachable today — documented that
  in an inline comment rather than silently deviating from the design or
  leaving it unexplained.
- Updated the acknowledge route's file-header doc comment and added the
  conditional audit insert inside the existing `db.transaction()`, gated on
  `txn.reconciledSessionId` (not on any new 403 — confirmed against the
  design's explicit "Out of Scope" item that this route must NOT gain a new
  lock).
- Wrote all 20 named unit tests:
  - `src/lib/ledger.test.ts` — tests 1-7, `isWithinReconciledLockCarveout`,
    inserted after the existing `deriveAckType` describe block, following
    that file's established import-list-plus-describe-block convention.
  - `src/app/api/admin/ledger/transactions/[id]/route.test.ts` — tests
    8-17, appended as a new `describe` block. Extended the existing
    hermetic `db` mock (previously a single generic `select().from()` that
    always resolved the same `partnerRows` array) to distinguish a donor
    lookup (`table === ledgerDonors`) from a partner-row lookup, and added
    `tx.insert()` support to the `db.transaction()` mock so the new
    `ledgerAuditLog` write could be captured and asserted on. Test 16 (the
    transfer-pair skip) deliberately seeds a RECONCILED partner row — if the
    `&& !carveout` clause were ever removed, that test would start failing
    with a 403 instead of silently passing for the wrong reason (an empty
    partner array would never have exercised the guard at all).
  - `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.test.ts` —
    tests 18-20, appended as a new `describe` block. Extended the existing
    `tx.insert()` mock to branch on table identity
    (`ledgerAcknowledgments` vs. `ledgerAuditLog`) since POST now inserts
    into both within the same transaction.
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (108 files / 2007 tests,
  all passing — up from 1987 before this phase, confirming exactly 20 new
  tests landed and nothing else regressed), and `pnpm build:only` (clean,
  full route manifest printed, no errors) as the three CLAUDE.md Phase 4
  gates.
- Confirmed no `console.log` was introduced in any production path (grepped
  all three touched non-test files).
- Confirmed via `git status` that only the six files listed under Outputs
  were touched — the concurrent uncommitted password-reset and
  stale-board-position efforts (including their `schema.ts` edits and
  `0101_drop_stale_board_position.sql`) were left untouched, per this
  ticket's explicit working-tree warning.

### Outputs

- **`src/lib/ledger.ts`** — added (no existing exports changed):
  - `RECONCILED_LOCK_CARVEOUT_FIELDS = ["donorId"] as const`
  - `isWithinReconciledLockCarveout(body: Record<string, unknown>): boolean`
    — true iff `body`'s key set is exactly `{ donorId }`.
  - `RECONCILED_DONOR_LINK_AUDIT_ACTION = "donor_linked_on_reconciled_transaction" as const`
- **`PATCH /api/admin/ledger/transactions/[id]`** (gate: `LEDGER_RECORD`,
  unchanged) — no request/response shape change. Behavior change: a request
  whose parsed body's key set is exactly `{ donorId }` (a valid donor id
  string, or `null` to unlink) now succeeds (200, `{ id }`) against a row
  with `reconciledSessionId` set, instead of 403ing. Any other body shape
  against such a row still 403s with the existing verbatim message:
  `"This transaction was cleared by a closed reconciliation session — reopen
  it to edit or delete this row"`. `approvedAt` ("Approved transactions
  cannot be edited") and `status === 'rejected'` ("Rejected transactions
  cannot be edited") still 403 unconditionally regardless of body shape — the
  carve-out never reaches those guards, checked before `await request.json()`
  exactly as before. A carve-out-shaped edit always takes the single-row
  write path, even when `?both=true` is passed against a transfer leg — the
  partner row is never fetched or locked-checked. A successful carve-out
  edit on a locked row writes one `ledgerAuditLog` row in the same
  `db.transaction()` as the donor-id update:
  `{ actorUserId, action: RECONCILED_DONOR_LINK_AUDIT_ACTION, targetTransactionId: id, before: JSON.stringify({donorId}), after: JSON.stringify({donorId}), details }`.
  An ordinary donor-link edit on a non-reconciled row writes no audit row
  (unchanged from today).
- **`POST /api/admin/ledger/transactions/[id]/acknowledge`** (gate:
  `LEDGER_RECORD`, unchanged) — no request/response shape change, no new
  guard/lock. New side effect only: when this route's existing unconditional
  `donorId` write fires (`donorId` truthy in the body) AND the transaction's
  `reconciledSessionId` is set, the same `ledgerAuditLog` row shape above is
  written in the same `db.transaction()` as the acknowledgment insert and
  donor-id update, with `details` additionally noting "via acknowledgment
  creation". No audit row when `donorId` is omitted, or when the transaction
  is not reconciled.
- **Schema:** none in this phase — consumed database-admin's
  `ledgerAuditLog.targetTransactionId` (nullable, FK →
  `ledgerTransactions.id`, `onDelete: "set null"`) and
  `ix_ledger_audit_log_transaction` index, already live in dev per the Phase
  4 (schema) section above. Migration `0102_ledger_audit_log_transaction_target.sql`
  (database-admin's, unmodified by me).
- **Tests added (all 20 named in Phase 3, all passing):**
  - `src/lib/ledger.test.ts` — 7 tests, `describe("isWithinReconciledLockCarveout", ...)`.
  - `src/app/api/admin/ledger/transactions/[id]/route.test.ts` — 10 tests,
    `describe("PATCH .../[id] — reconciled-lock donor-link carve-out (DECISION-099)", ...)`.
  - `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.test.ts` —
    3 tests, `describe("POST .../[id]/acknowledge — reconciled-lock donor-link audit trail (DECISION-099)", ...)`.
- **Files touched:**
  - `/Users/cshenso/git/westervillelions/src/lib/ledger.ts`
  - `/Users/cshenso/git/westervillelions/src/lib/ledger.test.ts`
  - `/Users/cshenso/git/westervillelions/src/app/api/admin/ledger/transactions/[id]/route.ts`
  - `/Users/cshenso/git/westervillelions/src/app/api/admin/ledger/transactions/[id]/route.test.ts`
  - `/Users/cshenso/git/westervillelions/src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts`
  - `/Users/cshenso/git/westervillelions/src/app/api/admin/ledger/transactions/[id]/acknowledge/route.test.ts`
- **Gates:** `pnpm exec tsc --noEmit` clean; `pnpm test` — 108 files, 2007
  tests, all passing; `pnpm build:only` — clean, no errors. No
  `console.log` in any touched production path. `auth()` + `hasFeature(...,
  FEATURES.LEDGER_RECORD)` gates confirmed unchanged/intact on both routes.

### Open questions / handoff notes

- **No ux-developer scope** — confirmed by both Phase 2 and Phase 3, and
  re-confirmed here: `link-donor-dialog.tsx` already PATCHes exclusively
  `{ donorId }` / `{ donorId: null }` and already surfaces the server's
  `error` string verbatim via `toast.error(data.error)`, so a reconciled row
  now simply succeeds instead of showing that toast — no component change
  needed for this to work end-to-end in the UI today.
- Next agent: **qa**, per the pipeline (Phase 5). Suggested manual
  click-through: in the admin Ledger UI, close a reconciliation session
  covering a transaction, then use "Link Donor" on that transaction — it
  should now succeed instead of showing the reconciled-lock error toast.
  Separately, try editing any other field (e.g. memo) on the same reconciled
  row via a direct API call — it should still 403.
  Also worth checking `/admin/ledger` for a `ledgerAuditLog` read-back
  surface: Phase 3 confirmed there is none today (write-only table), so the
  new audit rows are currently verifiable only via direct DB query or the
  unit tests — not something a treasurer can see in the app. That's
  consistent with the Phase 3 design's scope (no UI change identified) but
  worth flagging in case qa or analyst considers a future read-back surface
  worth a backlog item.
- The transfer-pair branch's now-unreachable `if (carveout) { ... }` copy
  (inside the `updateBoth && existing.transferGroupId && !carveout` branch)
  is dead code by construction, added deliberately per the Phase 3 design's
  explicit instruction ("Add the audit insert to both"). If a future change
  ever revisits that branch's entry condition, this is the one spot that
  would need re-examination.

---

## Phase 5 — Verification (qa) — 2026-09-21

**Owner:** qa
**Status:** complete

### Summary

**PASS.** All eight safety properties named in the QA brief were verified
independently — not by re-reading api-developer's tests, but by reading the
route code myself and then, for properties 1–5 and 8, firing real HTTP
requests at a real `pnpm dev` server backed by the real dev database, with
before/after DB state captured for every request. The allowlist is exact,
fails closed on every named shape (bundled arithmetic field, bundled
non-arithmetic field, typo'd key, empty body, unrelated field alone), and a
failed request applies nothing. `approvedAt`/`rejected` guards block a
`{donorId}`-only body on real approved and rejected rows, confirmed against
real rows I set up for the purpose. Ordinary non-reconciled edits are
unregressed. The transfer-pair branch is genuinely skipped for a carve-out
edit — verified against a real reconciled transfer pair I constructed, where
the partner leg would have 403'd had the branch been entered — and is
unaffected for non-carve-out edits (confirmed by reading the diff, which
adds only `&& !carveout` to the existing condition). The audit trail is
real: both write sites (PATCH carve-out, acknowledge-route donor write) each
produced a correctly-shaped `ledgerAuditLog` row with actor, transaction id,
before/after donor ids, session id, and timestamp. Migration `0102` replayed
cleanly three times (twice explicit, once via `pnpm dev` startup) with no
errors and no data loss — the pre-existing 631 `ledgerAuditLog` rows are
byte-for-byte unchanged. All fixture data I created for this verification
was fully removed and the four real transactions I temporarily modified were
restored to their exact original values, confirmed column-for-column against
a pre-change snapshot. `tsc --noEmit`, `pnpm test` (2007/2007), and
`pnpm build:only` all pass clean.

### What I did

- Read the full work-log (Phases 1–4), DECISION-099, and DECISION-036 item 4
  before touching anything, to know exactly which guarantees were being
  claimed and which were merely asserted.
- Read `src/lib/ledger.ts`'s new helper block
  (`RECONCILED_LOCK_CARVEOUT_FIELDS`, `isWithinReconciledLockCarveout()`,
  `RECONCILED_DONOR_LINK_AUDIT_ACTION`) — confirmed the allowlist check is
  `Object.keys(body).length === 1 && keys.includes("donorId")`, which fails
  closed by construction for every case named in the brief.
- Read `src/app/api/admin/ledger/transactions/[id]/route.ts` in full (both
  PATCH and DELETE) and
  `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts` in full.
  Confirmed by inspection: `approvedAt` and `status === 'rejected'` guards
  are unconditional and evaluated before `await request.json()`;
  `reconciledSessionId` guard alone moved after body parsing and is the only
  one gated on `carveout`; the transfer-pair branch condition gained exactly
  `&& !carveout` and nothing else; the "Build validated update payload"
  section only ever sets fields present in `body`, so a `{donorId}`-only
  body can never touch any other column even before the guard is reached;
  DELETE's `reconciledSessionId` guard is untouched (no carve-out reference
  anywhere in it). Both routes retain `auth()` + `hasFeature(session.user.id,
  FEATURES.LEDGER_RECORD)`, unchanged from before this ticket.
- Ran `pnpm exec tsc --noEmit` — clean, no output.
- Ran `pnpm test` — 108 files, 2007 tests, all passing (matches
  api-developer's reported count). Re-ran it again after all live-fire DB
  testing below to confirm no regression from the manual verification itself
  — still 2007/2007.
- Ran `pnpm build:only` — exit 0, full route manifest printed, no errors.
- Confirmed `git status` before and after all verification work is byte-for-
  byte identical to the snapshot at task start — no source file was touched;
  every check below was done via Bash/psql/curl against the running dev
  server and dev database, never by editing code.
- **Migration replay.** Ran `pnpm db:migrate` against `DATABASE_URL` (the dev
  Neon DB from `.env.local` — confirmed distinct from `PROD_DATABASE_URL`
  before running anything, and never read `PROD_DATABASE_URL` at any point)
  twice in a row, both clean. A third replay happened automatically via
  `pnpm dev`'s own migration step, also clean. Queried the live schema
  directly (`\d ledger_audit_log`): `target_transaction_id` is `uuid`,
  nullable, FK `ON DELETE SET NULL` to `ledger_transactions(id)`, indexed by
  `ix_ledger_audit_log_transaction` — exact match to the design. Queried row
  counts before touching any data: 631 total `ledgerAuditLog` rows, 540 with
  `target_category_id` set, 0 with `target_transaction_id` set (expected —
  no carve-out edit had ever happened in this DB before today).
- **Live-fire API verification.** No reconciled transaction existed in the
  dev DB at all (`ledger_reconciliation_sessions` was empty), so I could not
  test against pre-existing locked data. I built real fixtures instead of
  relying solely on mocked-DB unit tests:
  - Snapshotted (full row, all columns) four real Foundation-income
    transactions before changing anything.
  - Inserted one closed `ledger_reconciliation_sessions` row and pointed
    those four transactions' `reconciled_session_id` at it; additionally set
    `approved_at` on one and `status = 'rejected'` on another, to get a
    real approved+reconciled row and a real rejected+reconciled row.
  - Started `pnpm dev`, signed in via the real credentials flow as the
    seeded `E2E_ADMIN_EMAIL` account (`hasFeature` confirmed live via
    `/api/auth/session`: `ledger.record` present), and issued real `curl`
    requests carrying the real session cookie against the running server —
    not a mocked test harness.
  - After each request, queried the dev DB directly to confirm the actual
    row state, not just the HTTP status code.
  - Constructed a real transfer pair (two fresh, synthetic transaction rows
    sharing a `transfer_group_id`, both `reconciled_session_id`-locked) to
    test the transfer-pair-skip property, since none existed in the DB.
  - Deleted every fixture I created (the reconciliation session, the
    synthetic transfer pair, the acknowledgment I created, and all
    `ledgerAuditLog` rows generated by my own test requests) and restored
    the four real transactions to their exact pre-test values (verified
    column-for-column against the snapshot — output was byte-identical).
    Confirmed final `ledgerAuditLog` counts (631 / 540 / 0) and
    `ledgerTransactions` count (277) match the pre-test baseline exactly.
  - Stopped the dev server (`pkill -f "next dev"`) when done.

### Property-by-property verification

**1. Allowlist is exact-key-set, fails closed.** Verified via real PATCH
requests against a real reconciled row (`ec700e20-3021-4e50-9fd4-650fa913b146`):
  - `{donorId: "<jane>"}` → 200, `donor_id` updated in the DB (confirmed by
    direct query).
  - `{donorId: "<jane>", amountCents: 999999}` → 403, verbatim reconciled-
    lock message. Confirmed via direct query afterward that `donor_id`,
    `memo`, and `amount_cents` were **all unchanged** — not merely that the
    HTTP status was 403.
  - `{donorId: "<jane>", memo: "HACKED"}` → 403, `memo` unchanged.
  - `{donorID: "<jane>"}` (typo) → 403.
  - `{}` (empty) → 403.
  - `{categoryId: "<id>"}` (unrelated field alone) → 403.
  - `{donorId: null}` (unlink) → 200, `donor_id` cleared in the DB.
  All six failure shapes returned the exact same verbatim message: "This
  transaction was cleared by a closed reconciliation session — reopen it to
  edit or delete this row." Matches unit tests 8–11 exactly, now confirmed
  against a real request/real DB, not just a mock.

**2. Guard separation is intact.** Verified against a real approved+
reconciled row (`bc60efd9-c891-4b55-96cc-029a411323c0`, `approved_at` set)
and a real rejected+reconciled row (`c3f68609-8a9f-435d-8652-38e3e4104ec7`,
`status='rejected'`), both also carrying `reconciled_session_id`:
  - Approved row, `PATCH {donorId: "<jane>"}` → 403, `"Approved transactions
    cannot be edited"`. Confirmed `donor_id` stayed null afterward.
  - Rejected row, `PATCH {donorId: "<jane>"}` → 403, `"Rejected transactions
    cannot be edited"`. Confirmed `donor_id` stayed null afterward.
  This is the exact combination the brief called the single most dangerous
  possible regression, and it is confirmed correct against real rows, not
  just the mocked unit tests (which also pass — tests 12–13).

**3. Non-reconciled rows are unregressed.** PATCHed a real, non-reconciled
income transaction's `memo` (`{memo: "QA verification test edit"}`) → 200,
applied, then reverted. Ordinary editing is unaffected by this change.

**4. Transfer-pair branch is genuinely skipped for a carve-out edit, and
unaffected otherwise.** Built a real transfer pair (`aaaaaaaa-1111-...` /
`aaaaaaaa-3333-...`, both legs `reconciled_session_id`-locked). `PATCH
.../aaaaaaaa-1111-...?both=true` with `{donorId: "<jane>"}` → 200. If the
transfer-pair branch had been entered, the partner leg's own
`reconciledSessionId` guard would have 403'd (verbatim: "The paired transfer
transaction was cleared by a closed reconciliation session...") — it did
not. Confirmed by direct query afterward: the source leg's `donor_id` was
set and `updated_at` bumped; the **partner leg's `donor_id` stayed null and
its `updated_at` was untouched** — proof the partner row was never written,
not merely that the response was 200. For the non-carve-out case, I did not
re-run a live request (constructing a non-reconciled transfer pair adds no
new evidence over reading the diff, which shows the *only* change to that
branch's condition is the added `&& !carveout` clause — everything else in
that ~60-line block, including the `symmetricUpdate` construction and the
partner-fetch, is untouched) — this is confirmed by code reading plus the
existing, passing regression unit test 17.

**5. Audit row is actually written.** Confirmed via direct DB query after
each successful carve-out edit:
  - PATCH-route link: `before={"donorId":null}`,
    `after={"donorId":"<jane>"}`, `action:
    donor_linked_on_reconciled_transaction`, `actor_user_id` = the signed-in
    admin's real user id, `details` names the real session id.
  - PATCH-route unlink: `before={"donorId":"<jane>"}`, `after={"donorId":null}`.
  - PATCH-route transfer-leg carve-out: one row, same shape, confirming the
    single-row `donorLinkChanged` branch fired (not the transfer-pair
    branch's structurally-dead copy).
  - Acknowledge-route: `POST .../acknowledge` with `{donorId, typeOverride:
    "written_ack_250"}` against the reconciled `4e64417b-...` transaction →
    201, donor written, and one `ledgerAuditLog` row with `details` ending
    "(donor linked via acknowledgment creation)" — the differentiated
    wording specified in Phase 3.
  All rows written inside the correct `db.transaction()` alongside the
  donor-id update, per the design.

**6. Existing `ledgerAuditLog` category-audit writes are unaffected.**
Pre-existing row count (631 total, 540 with `target_category_id`) confirmed
identical before and after all testing. Full `pnpm test` (2007/2007,
including `ledger-category-queries.test.ts` and
`ledger-acknowledgment-letter-queries.test.ts`) re-run after the live-fire
testing — still green.

**7. Migration `0102` replays cleanly.** Ran three times against dev (twice
explicit `pnpm db:migrate`, once via `pnpm dev` startup) — no errors, no
change on replay. Live schema matches the design exactly (see "What I did"
above).

**8. Permission gates intact.** Both routes retain `auth()` +
`hasFeature(session.user.id, FEATURES.LEDGER_RECORD)`, confirmed by reading
the code (unchanged from before this ticket — this feature added no new
gate and removed none). Live-verified the unauthenticated case: an
unauthenticated `curl` PATCH and an unauthenticated `curl` POST to the
acknowledge route both returned `401 {"error":"Unauthorized"}` before
touching the DB (confirmed no row changed). For the under-privileged case, I
did not reset a real member's password to obtain a second live session — a
prior QA run in this project did exactly that and left a member's password
unrecoverable, which this ticket explicitly warned against repeating.
Instead I queried `role_features` directly: only the `admin` and
`treasurer` roles carry the `ledger.record` feature; every `member` and
plain `board_member` account in the dev DB lacks it, so
`hasFeature(userId, FEATURES.LEDGER_RECORD)` for any of them evaluates to
`false` against the same unmodified gate line already confirmed live for the
unauthenticated case. This is real-DB-backed evidence of denial for an
under-privileged caller, short of a live 403 from an actual under-privileged
session.

### Outputs

- No files modified — verification only. `git status` before and after this
  phase is identical to the snapshot at task start.
- `docs/work-log/2026-09-21-reconciled-donor-link-carveout.md` — this
  section, and the status table updated (Phase 5: Complete / PASS).
- Dev database (`DATABASE_URL` in `.env.local`) — used as scratch space for
  live-fire verification; all fixture rows created during this phase were
  deleted and all four temporarily-modified real transactions were restored
  to their exact pre-test values (verified column-for-column). Final state:
  277 `ledger_transactions` rows (unchanged count), 631 `ledger_audit_log`
  rows with `target_transaction_id` back to 0 (unchanged from baseline), 0
  `ledger_reconciliation_sessions` rows (unchanged — none existed before or
  after). `PROD_DATABASE_URL` was never read by anything run in this phase.

### Type Check
`pnpm exec tsc --noEmit`: **PASS** (clean, no output)

### Unit Tests
`pnpm test`: **PASS**
Total: 2007 | Passed: 2007 | Failed: 0
Files: 108
Duration: ~2s
Failures: none. All 20 tests named in the Phase 3 design doc
(`src/lib/ledger.test.ts` tests 1–7, `.../[id]/route.test.ts` tests 8–17,
`.../acknowledge/route.test.ts` tests 18–20) are present and passing, and
were independently read line-by-line against the actual route code (not
just executed) — see "Property-by-property verification" above for the
real-request confirmation of what they assert.

### Production Build
`pnpm build:only`: **PASS**
Notes: exit code 0, full route manifest printed (all `/api/admin/ledger/...`
routes present), no errors or unexpected warnings.

### End-to-End Tests
`pnpm test:e2e`: **not run**. No existing Playwright spec covers the Ledger
donor-link surface, and this ticket's own scope is two narrow server-route
changes with no UI change (confirmed by both Phase 2 and Phase 3, and by my
own reading of `link-donor-dialog.tsx`, which already sends exactly
`{donorId}` / `{donorId: null}`). Running the full ~12-minute suite would
add no coverage of this change. In its place I did real-request, real-DB
verification against the live routes (see "Live-fire API verification"
above), which is a closer proxy to an e2e test than a unit test is, and
covers every property the manual click-through was meant to establish
except literal DOM interaction with the dialog.

### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Link donor via PATCH on a closed-reconciliation-session transaction | pass | Real HTTP request, real session, real dev DB — `{donorId}` → 200, donor persisted, verified by direct query. Toast-level UI click-through not performed (no browser driver available to this agent); the dialog's exact request payload was confirmed by reading `link-donor-dialog.tsx` (`linkDonor()`/`unlinkDonor()` send exactly this shape), so the live API-level test is a faithful stand-in. **Recommend the user do one real click-through in a browser before considering this fully closed** — see Open questions below. |
| Unlink donor (`donorId: null`) on the same reconciled row | pass | Real HTTP request, 200, `donor_id` cleared, verified by direct query. |
| Bundled-field / typo / empty-body rejection on a reconciled row | pass | All six failure shapes 403 with the verbatim message; DB state unchanged in every case, verified by direct query. |
| `approvedAt` / `rejected` guard precedence over the carve-out | pass | Verified against real approved and real rejected rows, both also reconciled. |
| Transfer-pair branch skip for a carve-out edit | pass | Verified against a real, constructed reconciled transfer pair; partner leg proven untouched. |
| Audit trail (both write sites) | pass | Verified by direct query — actor, transaction id, before/after donor ids, session id, timestamp all correct on every write. |
| Migration `0102` idempotent replay | pass | Ran 3 times against dev, no errors, schema matches design. |
| `auth()` gate (unauthenticated) | pass | Live 401 on both routes. |
| `hasFeature(LEDGER_RECORD)` gate (under-privileged) | pass (by role-table query, not a live session) | Confirmed only `admin`/`treasurer` roles carry `ledger.record` in the dev DB; did not reset a real member's password to obtain a second live session (see rationale above). |

### Regression Tests Added
None — all needed regression coverage was already delivered by
api-developer in Phase 4 (the 20 named tests), which I independently
verified against the real route code and, for the properties that matter
most, against a real running server and real database. No gap was found
that would need a new test.

### Coverage on Critical Modules
Not separately re-measured with `--coverage` this phase — `src/lib/ledger.ts`
is exercised extensively by the pre-existing suite (2007 tests across 108
files) plus the 7 new `isWithinReconciledLockCarveout` tests; no coverage
regression is plausible given the full suite passes and every new branch in
the helper has a dedicated test (link, unlink, bundled-arithmetic, bundled-
non-arithmetic, absent, empty, typo).

### Feature-Gate Audit (mandatory before PASS)

No new protected route or server action was added by this feature — both
touched routes already existed and were already gated. Audited anyway per
the mandatory-audit rule:

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `PATCH /api/admin/ledger/transactions/[id]` | yes | yes | `FEATURES.LEDGER_RECORD` — unchanged from before this ticket; correct (mutation endpoint, matches every other write path on this route) |
| `POST /api/admin/ledger/transactions/[id]/acknowledge` | yes | yes | `FEATURES.LEDGER_RECORD` — unchanged from before this ticket; correct |

Both gates read directly from the route source (not inferred from passing
tests), and both were live-verified to reject an unauthenticated caller
(401) before any DB read.

### Verdict: PASS

### Verified Fact vs. Root-Cause Theory

**Established (reproduced, more than one method each):**
- The allowlist fails closed on every named shape — confirmed by reading the
  helper's implementation, by the 7 unit tests, and by 6 real HTTP requests
  against a real reconciled row with DB-state confirmation.
- `approvedAt`/`rejected` guards outrank the carve-out — confirmed by
  reading the guard ordering in the route, by unit tests 12–13, and by 2
  real HTTP requests against real approved/rejected rows.
- The transfer-pair branch is skipped for a carve-out edit — confirmed by
  reading the branch condition, by unit test 16, and by 1 real HTTP request
  against a real constructed transfer pair with DB-state confirmation that
  the partner leg was never written.
- The audit trail is real and correctly shaped at both write sites —
  confirmed by reading the insert call sites, by unit tests 14/18, and by 4
  real audit rows produced by real requests and inspected directly.
- Migration `0102` is idempotent — confirmed by 3 real replays against dev.

**Not separately theorized:** this phase found no defect, so there is no
root-cause claim to separate from a verified fact. Every claim above is a
verified fact, not a theory.

### Open questions / handoff notes

- **Recommend one real browser click-through before this is considered
  fully closed end-to-end.** I verified the exact HTTP request the
  `link-donor-dialog.tsx` component issues, and confirmed that request
  succeeds against a real reconciled row with real persistence — but I have
  no browser driver in this environment, so I never saw the actual toast
  disappear or the dialog close on screen. This is a very low-risk gap (the
  component code is simple and its request shape was read directly, not
  guessed), but the original ticket asked for a literal click-through and I
  want that named rather than silently substituted.
- No defect found. No loop-back needed.
- Next agent: **analyst**, for Phase 6 (shipped-vs-intent review).
- For analyst's Phase 6 review: worth confirming with the user whether the
  "no read-back UI for `ledgerAuditLog`" gap api-developer flagged (the new
  audit rows are only visible via direct DB query or the unit tests, not to
  a treasurer in the app) should become a tracked backlog item — it's
  consistent with this ticket's scope (Phase 3 explicitly found no UI change
  needed) but is worth a deliberate decision rather than silent acceptance.

---

## Phase 6 — Shipped vs Intent (analyst) — 2026-09-21

**Owner:** analyst
**Status:** complete

### Summary

**SHIP IT on the mechanism, SHIP WITH NOTES on the paper trail around it.**
The Treasurer's actual complaint — a blanket 403 on linking a donor to a
reconciled transaction — is fixed, verified against a real running server
and real DB state, not just mocks. The carve-out is exactly as narrow as
DECISION-099 specified: an allowlist of one field, fails closed on every
adversarial shape (bundling, typos, empty body), `approvedAt`/`rejected`
stay untouched, DELETE stays untouched, and DECISION-036's core guarantee —
a closed session's arithmetic cannot move without reopening — is provably
intact because `donorId` is read by nothing that computes a tie-out. The
audit trail is real at both write sites. Three items keep this from a clean
SHIP IT: the acknowledge-route bypass finding was judged sound but was never
written back into the decision log, `ledgerAuditLog` is now write-only in
two places instead of one with no path to ever being read, and nobody has
physically clicked the dialog in a browser.

### What I did

- Re-read my own (reconstructed) Phase 1 recap, DECISION-099 in full, and
  DECISION-036 item 4 (read-only, as instructed).
- Read Phases 2-5 of this work-log in full, including QA's property-by-
  property verification and its Verified-Fact-vs-Theory section.
- Did not trust the work-log's claims at face value — pulled the actual
  diffs and read the shipped code directly:
  - `git diff -- src/app/api/admin/ledger/transactions/[id]/route.ts` — confirmed
    the guard restructuring is exactly as described: `approvedAt` and
    `status === 'rejected'` remain byte-for-byte unconditional, evaluated
    before `await request.json()`; only the `reconciledSessionId` guard
    moved and gained the `carveout` conditional; the transfer-pair branch
    gained exactly `&& !carveout` and nothing else; both `donorLinkChanged`
    branches (transfer-pair copy and standalone copy) carry the audit
    insert, gated on `if (carveout)`.
  - `git diff -- .../acknowledge/route.ts` — confirmed the fix is
    attribution-only: one conditional `ledgerAuditLog` insert added inside
    the existing `db.transaction()`, gated on `txn.reconciledSessionId`, no
    new 403 anywhere in the route.
  - `git diff -- src/lib/ledger.ts src/lib/db/schema.ts` — confirmed
    `isWithinReconciledLockCarveout()` is a strict `Object.keys(body).length
    === 1 && keys.includes("donorId")` check (fails closed by construction,
    no denylist to fall out of sync), and `ledgerAuditLog.targetTransactionId`
    is nullable, `ON DELETE SET NULL`, matching `targetCategoryId`'s shape.
  - Read `drizzle/migrations/0102_ledger_audit_log_transaction_target.sql`
    directly — both statements are `IF NOT EXISTS`-guarded, idempotent,
    additive only.
  - Read `src/app/api/admin/ledger/transactions/[id]/route.ts`'s DELETE
    handler directly (lines ~730-780) — its `reconciledSessionId` guard has
    no reference to `carveout` anywhere; untouched, as promised.
  - Read `src/components/admin/ledger/link-donor-dialog.tsx` directly —
    `linkDonor()` sends exactly `JSON.stringify({ donorId })`,
    `unlinkDonor()` sends exactly `JSON.stringify({ donorId: null })`. No
    other field is ever bundled. Confirms the real client's request shape
    matches what QA live-fire-tested, independent of QA's own claim.
  - Grepped every `ledgerAuditLog` reader/writer across `src/` — confirmed
    the only writers are the two pre-existing category-audit call sites
    (`ledger-category-queries.ts`, `ledger-acknowledgment-letter-queries.ts`)
    plus this ticket's two new ones; grepped `src/app/(dashboard)/admin/ledger/`
    for any UI reference to the table — none. QA's and tech-lead's
    "write-only table, zero readers" claim holds, independently confirmed.
- Checked `git status` to confirm scope discipline held: the three unrelated
  uncommitted efforts (admin password reset, stale-board-position fix,
  sub-$250 donor worklist) are present in the tree but untouched by this
  ticket's file list, exactly as Phase 4's api-developer and database-admin
  sections claimed.

### Intent-vs-shipped diff

1. **Phase 1 said:** the Treasurer needs to link (and, implicitly, unlink) a
   donor on a transaction a closed reconciliation session has already
   cleared, without reopening the session. **Shipped:** `PATCH
   /api/admin/ledger/transactions/[id]` with body exactly `{ donorId }` or
   `{ donorId: null }` now succeeds against such a row; any other body shape
   still 403s verbatim. **Verdict: matches.** This is the whole point of the
   ticket and it is delivered, verified against real HTTP requests and real
   DB state (QA property 1, independently spot-checked by me against the
   diff).
2. **Phase 1's constraint said:** field bundling with an arithmetic-affecting
   field must be rejected outright, checked server-side after body parsing.
   **Shipped:** an allowlist that rejects *any* second field, arithmetic or
   not — narrower than Phase 1 asked for, per DECISION-099's Ruling #3.
   **Verdict: matches (and is a strict improvement over the letter of the
   ask)** — Phase 1's own adversarial pass anticipated someone might try to
   sneak an arithmetic field in disguised as something else; the allowlist
   closes that off by construction rather than by a maintained list.
3. **Phase 1's constraint said:** the DELETE route's reconciled lock must
   stay untouched. **Shipped:** confirmed by direct code read — no
   reference to `carveout` or the new helper anywhere in DELETE. **Verdict:
   matches.**
4. **Phase 1's constraint said:** the `approvedAt` guard must not weaken
   during any restructuring. **Shipped:** `approvedAt` and `rejected` remain
   two separate, unconditional guards evaluated before body parsing, never
   consulting `carveout`. Verified against real approved and real rejected
   rows by QA, and against the raw diff by me. **Verdict: matches.**
5. **Phase 2/DECISION-099 said:** an audit trail is required, not optional,
   and must not misuse `ledgerAuditLog`'s category-scoped contract.
   **Shipped:** a new nullable `targetTransactionId` column (a forward-
   compatible generalization the origin migration had already earmarked),
   one shared action constant, both write sites recording actor, before/
   after donor ids, the locking session id, and a timestamp. **Verdict:
   matches** on shape and correctness — see the separate judgment call below
   on whether the *investment* was proportionate.
6. **Not in Phase 1 at all, found in Phase 3:** the acknowledge route had
   been writing `donorId` onto reconciled rows with zero guard, silently,
   since it shipped. **Shipped:** attribution added (an audit row now
   fires), no new lock added. **Verdict: acceptable drift** — judged below,
   not a straightforward "matches" because Phase 1 never scoped this route
   at all; it surfaced mid-pipeline and the team made a reasoned call about
   it rather than silently expanding scope or silently ignoring the finding.

### Edge cases

- **Empty state:** not applicable — this is a guard change on an existing
  mutation route with no new list/collection UI.
- **Failure microcopy:** pass. The reconciled-lock 403 message is unchanged
  and was already human ("This transaction was cleared by a closed
  reconciliation session — reopen it to edit or delete this row"), and it
  now fires only for the cases that should still be blocked. `approvedAt`/
  `rejected` messages are unchanged and already human.
- **Permission gate:** pass. `LEDGER_RECORD` unchanged on both routes,
  confirmed present in both `route.ts` files by direct read; QA live-verified
  401 on both for an unauthenticated caller and confirmed via the
  `role_features` table that only `admin`/`treasurer` carry `ledger.record`
  in dev.
- **Mobile:** not applicable — server-only change, `link-donor-dialog.tsx`
  itself is unmodified.
- **Brand consistency:** not applicable — no UI was touched.

### Judgment call A — the acknowledge-route finding

**The call was right, but it's undocumented where it needs to be.** The
route's body shape is genuinely fixed server-side — `donorId`,
`typeOverride`, `quidProQuoValueCents`, `quidProQuoDescription`, `purpose`
only, with `amountCents` always copied from the transaction row rather than
accepted from the caller — so there is no way to smuggle an arithmetic
change through it, carve-out or not. More than that: locking this route
would have been actively wrong, not just unnecessary scope creep — creating
an acknowledgment letter for a donation whose transaction happens to already
be reconciled is a completely ordinary treasurer action (reconciliation and
acknowledgment-letter generation are two independent workflows on the same
row), and a new 403 there would have reintroduced a version of the exact
problem this ticket was opened to fix, on a second route. Attribution
without restriction is the correct shape.

What's missing: this reasoning lives only in this work-log's Phase 3
section and in the route's own header comment. `docs/decisions.md` still
only has DECISION-099 as written in Phase 2 — before this bypass was found —
which does not mention the acknowledge route at all. A future security or
code review that greps for "writes to `ledgerTransactions` with no
`reconciledSessionId` check" will find this route again and, without the
decision log entry, has no way to know it was already found, reasoned
about, and intentionally left unlocked. That's exactly the kind of
knowledge-loss the decision log exists to prevent. **I did not edit
`docs/decisions.md` myself** (another agent has it open for a different
ticket, per this review's scope instructions) — flagging this to the user
directly: DECISION-099 (or a new, small decision entry amending it) should
gain a line recording that the acknowledge route's donor write is
deliberately unguarded because its body shape cannot reach arithmetic, so
this doesn't get "rediscovered" as a bug later.

### Judgment call B — was the audit trail worth its cost?

**Insurance, not theater — but insurance nobody can currently read is
insurance you can't prove you bought.** The cost was real but smaller than
it first looks: the origin migration for `ledgerAuditLog`
(`0074_ledger_category_audit.sql`) had already earmarked
`target_transaction_id` as a planned column, so this wasn't inventing new
schema shape under time pressure — it was filling in a slot the table was
designed to grow into. The specialist split (database-admin → api-developer)
this project already uses for every schema-touching feature absorbed the
extra implementer, rather than the audit trail uniquely causing that split.
Given DECISION-099 explicitly ruled attribution non-negotiable for a
deliberate hole punched in a hard financial-integrity lock, and this
codebase already attributes every comparable action (receipt waivers,
session close/reopen), *not* building this would have been the surprising
choice, not building it.

The real gap is downstream: `ledgerAuditLog` was already a write-only table
before this ticket, and this ticket adds two more writers to it without
adding a first reader. Confirmed independently (grepped
`src/app/(dashboard)/admin/ledger/` — no reference to the table anywhere).
If a donor dispute or a 990 review ever needs to answer "who linked this
donor, and when, and was the row locked at the time" — exactly the question
this audit trail was built to answer — today's honest answer is "someone
with `psql` access can tell you," not "the Treasurer can look it up." That
gap predates this ticket (it was already true for category-audit rows) but
this ticket makes it wider without being asked to fix it, which is a fair
scope boundary — but it should not go unrecorded.

**What would make it readable:** the cheapest version is not a full audit
browser — it's surfacing the relevant rows exactly where a treasurer would
already be looking. Two candidates, either would close this: (a) on the
transaction detail / edit surface, when `donorId` was last changed while the
row was reconciled, show a small "Donor linked after reconciliation on
<date> by <actor> — see audit log" note pulled from the newest matching
`ledgerAuditLog` row; or (b) a minimal `/admin/ledger` audit-log list page,
filterable by transaction or category, which both this table's writers
could eventually share. Either is a small, well-scoped follow-up, not a
reason to hold this ship.

### Judgment call C — no literal browser click-through

**Reasonable residual risk, does not gate shipping.** QA had no browser
driver available, so the manual click-through was a live HTTP request
against the real route with a real session and real DB-state assertions,
plus a direct read of `link-donor-dialog.tsx`'s request-construction code —
which I independently re-read myself rather than taking QA's word for it,
and it matches exactly (`JSON.stringify({ donorId })` /
`JSON.stringify({ donorId: null })`, nothing else). The component has no
client-side branching that could produce a different request shape than
what was read. The risk this residual gap covers — a rendering bug, a
stale-toast bug, a focus-trap bug in the dialog itself — is real but
unrelated to the financial-integrity properties this ticket exists to
protect, and none of those bug classes were touched by this diff (the
dialog component itself is unmodified — `git diff --stat` confirms it isn't
in the changed-file list). Recommend the Treasurer (or the user) do one real
click the next time they're in the Ledger UI, but this should not block
closing the ticket.

### Follow-ups (SHIP WITH NOTES)

1. **Add a line to `docs/decisions.md` recording the acknowledge-route
   ruling.** Amend DECISION-099 (or log a small new decision) stating: the
   acknowledge route's `donorId` write is deliberately left unguarded
   against `reconciledSessionId`/`approvedAt`/`status`, because its request
   body shape is fixed server-side and can never carry an arithmetic field;
   only attribution (a `ledgerAuditLog` row) was added, not a new lock. I
   did not make this edit myself per this review's scope constraint (another
   agent has `docs/decisions.md` open); route this to whichever agent picks
   it up next, or make the edit directly once the concurrent edit is done.
2. **Give `ledgerAuditLog` a read-back path, even a minimal one.** Track as
   a backlog item: surface the newest matching audit row on the transaction
   detail view when a donor was linked/unlinked while the row was
   reconciled, or add a small filterable admin list page for the table.
   Either closes the "insurance nobody can see" gap named above. Not
   urgent — no dispute has surfaced yet that needs this — but should not be
   allowed to drift indefinitely now that the table has two independent
   event types feeding it and zero consumers.
3. **Do one real browser click-through of Link Donor / Unlink Donor on a
   reconciled transaction** the next time someone is in the admin Ledger UI,
   to close the one verification gap QA could not reach in this environment.
   Low cost, not blocking.

### No red flags

Nothing here requires a loop-back to Phase 3 or 4. The mechanism is correct,
narrow, and verified against real requests and real DB state; the two
judgment calls both check out on their merits; the notes above are
documentation and follow-through items, not defects in what shipped.

### Outputs

- `docs/work-log/2026-09-21-reconciled-donor-link-carveout.md` — this
  section, and the status table updated (Phase 6: Complete / SHIP WITH
  NOTES).
- No code changed in this phase (shipped-vs-intent review only).
- `docs/decisions.md` — **not edited**, per this review's explicit scope
  constraint; Follow-up #1 above names the edit it still needs.

### Open questions / handoff notes

- Route Follow-up #1 (the DECISION-099 amendment) to whoever has
  `docs/decisions.md` free next, or to tech-lead directly.
- Follow-up #2 (audit-log read-back surface) is a genuine backlog candidate
  — worth a `B-nn` entry in `docs/backlog.md` if the user agrees it's worth
  tracking now rather than waiting for a real need.
- Follow-up #3 (browser click-through) can be closed by the user directly
  in under a minute the next time they're signed in as an admin.
- Pipeline closed: **SHIP WITH NOTES**.

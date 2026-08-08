# Donor — Multiple Email Addresses — Work Log

> **Slug:** `2026-08-08-donor-multiple-emails`
> **Surface:** (dashboard) admin — The Ledger, Donors
> **Permission(s):** existing `LEDGER_RECORD` (read/write) and `LEDGER_MANAGE` (delete) cover this — no new permission
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phase 1 folded into this entry (treasurer's request + decisions were fully specified by the user up front); Phase 2 skipped (rationale below); Phase 3 folded into this entry (small, tightly coupled — full-stack-developer authors a brief design directly). Implementer: full-stack-developer.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | full-stack-developer (folded) | Complete | READY FOR DESIGN | 2026-08-08 |
| 2 — Architectural review | — | Skipped | N/A — see rationale | 2026-08-08 |
| 3 — Technical design | full-stack-developer (folded) | Complete | Design complete | 2026-08-08 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-08-08 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (folded)

## VERDICT

READY FOR DESIGN

## ONE-LINE TAKE

> Treasurer wants `ledger_donors` to hold zero-or-more equal-weight email addresses instead of one, starting with Trucco Construction Co's two addresses, for a future emailing feature to use — no emailing is built now.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Treasurer/admin (LEDGER_RECORD) | Add/remove an email address on a donor (create or edit) | Occasional, per-donor |
| Treasurer/admin (LEDGER_RECORD) | Search donors by any of their email addresses | Occasional |
| Treasurer/admin (LEDGER_RECORD) | View all of a donor's email addresses on the donor record and in donor pickers | Every donor-record visit |

## Flows

**Flow 1 — Add a second address to an existing donor:** Donors list → open Trucco Construction Co → Edit → type second address into the "add email" field → Enter/Add → address appears as a removable chip → Update Donor → donor record now shows both.
- Failure: malformed address → inline/toast rejection, nothing added. Duplicate (case-insensitive) of an address already in the list → rejected with a toast, nothing added.

**Flow 2 — Create a donor with one or more addresses:** Donors list → Add Donor → name (required) → add zero or more emails via the same add/remove control → Add Donor → donor created.

**Flow 3 — Search:** Donors list → search box → matches donor name OR any address in the donor's list (unchanged search UX, extended matching).

## Permissions

- No new permission. `LEDGER_RECORD` already gates donor create/edit/view; `LEDGER_MANAGE` already gates delete. This feature only changes what one existing field looks like.

## Gaps the Request Didn't Address

- **Cross-donor dedup on create.** The existing POST had a soft 409 dedup on (name + email) to avoid double-entering the same donor. With email now a list, this is generalized to (name + any shared address) rather than dropped — preserves the existing safety net with minimal surface change. Noted as an implementer decision, not a new requirement.
- **Ordering/display of multiple addresses in compact contexts** (donor search typeahead in Acknowledge/Link-Donor dialogs, donor list table column) — the treasurer didn't specify. Resolved as: first address shown, "+N more" suffix when there's more than one, full list on the donor detail page. Documented in Phase 3.

## Out of Scope (confirmed via task constraints)

- Any emailing/`sendEmail()` — storage/display only, per explicit constraint.
- Acknowledgment-letter generation feature — separate in-flight design (`2026-08-08-acknowledgment-letter-generation.md`), not touched.
- Labels, primary/alternate distinction, contact-management UI — explicitly rejected by the treasurer in favor of a flat list.

## Open Questions

None outstanding — treasurer's decisions in the request cover the data-model question; remaining implementation choices (dedup behavior, compact display) are implementer calls documented below.

---

# Phase 2 — Architectural Review — SKIPPED

**Rationale for skip:** No new directory, no new npm dependency, no new route group, no new client/server boundary pattern. This is a column-shape change on an existing table (`ledger_donors`) plus edits to existing files (existing API routes, existing query functions, existing form/list/dialog components) that already follow established patterns in this codebase (array columns already exist — `events.recurrenceDays` — and the existing `event-form.tsx` already demonstrates the "local array state, full-list replace on submit" UI pattern this feature reuses). No invariant is touched in a way that needs architect sign-off. Documenting the skip per CLAUDE.md's no-silent-skips rule.

---

# Phase 3 — Technical Design (folded)

## Summary

Replace `ledger_donors.email` (nullable `text`) with `ledger_donors.emails` (`text[]`, `NOT NULL DEFAULT '{}'`), a flat, unordered, unlabeled list. Every reader/writer of the old scalar field is updated: the two donor API routes, `listDonors()`/`getDonor()` in `ledger-queries.ts`, and five UI files that read or edit `donor.email`. Postgres array columns are an established pattern in this schema (`events.recurrenceDays`), so a child table was considered and rejected — see Phase 4 database-admin-equivalent reasoning in the Files Modified section for `schema.ts`.

## Permissions

No change — existing `LEDGER_RECORD` / `LEDGER_MANAGE` gates on the donor routes are untouched.

## API Contract

- `GET /api/admin/ledger/donors?search=...` — now delegates to `listDonors()` (previously duplicated the query inline); response shape unchanged (`{ donors, total }`), search now matches any address in a donor's list.
- `POST /api/admin/ledger/donors` — body gains `emails?: string[]` (replaces `email?: string`). Validates each entry as an email, rejects case-insensitive duplicates *within the submitted list* (400), and generalizes the existing 409 soft-dedup to "same name + any overlapping address."
- `PATCH /api/admin/ledger/donors/[id]` — body gains `emails?: string[] | null` (full-list replace, same pattern as `PATCH` events' `recurrenceDays`). Matches this route's existing null-vs-omitted convention for `address`/`memberId`: omitted leaves the stored list untouched, `null` clears it to `[]`, an array replaces it wholesale. The endpoint does not support partial add/remove server-side — the client always submits the complete desired list, matching `event-form.tsx`'s established pattern for array fields.
- `GET /api/admin/ledger/donors/[id]` — unchanged shape, `email` field replaced by `emails: string[]`.

## Data Model

- `drizzle/migrations/0077_ledger_donor_emails.sql` — adds `ledger_donors.emails text[] NOT NULL DEFAULT '{}'`, backfills any existing non-null `email` into a single-element array, drops `email`. Idempotent (guarded backfill + `IF NOT EXISTS`/`IF EXISTS`), verified by applying twice against the dev DB.
- `src/lib/db/schema.ts` — `ledgerDonors.emails: text("emails").array().notNull().default([])`.

## Component / Page Plan

- Modify: `src/components/admin/ledger/donor-form.tsx` (add/remove chip UI, full-list submit)
- Modify: `src/components/admin/ledger/donor-list.tsx` (search + table column)
- Modify: `src/app/(dashboard)/admin/ledger/donors/[id]/donor-detail-client.tsx` (full list display)
- Modify: `src/components/admin/ledger/acknowledge-dialog.tsx`, `src/components/admin/ledger/link-donor-dialog.tsx` (compact subtitle display)
- New shared helper: `formatEmailList()` in `src/lib/utils.ts` for the compact "first + N more" display used by the three secondary-display sites.

## Implementation Order

1. Schema + migration
2. `ledger-queries.ts` (`listDonors` array-aware search, `getDonor`/donor shape flow-through — no other query changes needed)
3. API routes (`donors/route.ts`, `donors/[id]/route.ts`)
4. UI (form, list, detail, two compact-display dialogs, shared formatter)
5. Unit tests

No email notification, no release-notes-worthy user-facing surface beyond the admin Ledger UI (release notes deferred to the normal release-notes pass at push time, per `feedback_release_notes` memory — not part of this work-log).

## Edge Cases & Risks

- Empty list (`[]`) is valid and the default — a donor with zero addresses must not error anywhere that reads `donor.emails`.
- Case-insensitive duplicate within one submitted list → 400, not a silent dedupe (predictable, and the client already prevents it before submit).
- Existing donor row(s) with `email IS NULL` must backfill to `emails = '{}'`, not `['null']` or similar — migration must not "backfill" nulls.
- `donorEmailsMatch()` search helper must use `unnest(...) ILIKE` (per-element substring match), not `array_to_string(...)::text ILIKE`, to avoid false-positive substring matches spanning the Postgres array literal's brace/comma syntax.

## Implementer

full-stack-developer (this entry)

---

# Phase 4 — Implementation

## Files Created

- `drizzle/migrations/0077_ledger_donor_emails.sql` — schema migration (see Schema Changes below)
- `src/lib/ledger-queries.donors.test.ts` — unit tests for `listDonors()` array-aware search
- `src/app/api/admin/ledger/donors/route.test.ts` — unit tests for GET (search) / POST (validation, dedup)
- `src/app/api/admin/ledger/donors/[id]/route.test.ts` — unit tests for PATCH (full-list replace, validation)

## Files Modified

- `src/lib/db/schema.ts` — `ledgerDonors.email` → `ledgerDonors.emails` (`text[]`, not null, default `[]`)
- `src/lib/ledger-queries.ts` — `listDonors()` search now matches name OR any array element via a `unnest(...) ILIKE` helper
- `src/app/api/admin/ledger/donors/route.ts` — GET now delegates to `listDonors()`; POST validates/normalizes `emails: string[]`, generalized soft-dedup
- `src/app/api/admin/ledger/donors/[id]/route.ts` — PATCH validates/normalizes `emails: string[] | null | undefined` (full-list replace)
- `src/components/admin/ledger/donor-form.tsx` — add/remove email chip UI, full-list submit
- `src/components/admin/ledger/donor-list.tsx` — search matches any address; table column shows compact list
- `src/app/(dashboard)/admin/ledger/donors/[id]/donor-detail-client.tsx` — full address list display
- `src/components/admin/ledger/acknowledge-dialog.tsx` — compact display (donor typeahead result + selected-donor chip)
- `src/components/admin/ledger/link-donor-dialog.tsx` — compact display (donor picker list)
- `src/lib/utils.ts` — added `formatEmailList()` helper

## Schema Changes

- `ledger_donors.email` (nullable `text`) → `ledger_donors.emails` (`text[] NOT NULL DEFAULT '{}'`)
- Migration file: `drizzle/migrations/0077_ledger_donor_emails.sql` (idempotent — verified by applying twice against the dev DB, see Implementer Notes)

## Implementer Notes

**Array column vs. child table.** Checked `src/lib/db/schema.ts` for existing array columns before introducing the pattern for donors: one precedent exists — `events.recurrenceDays` (`integer("recurrence_days").array()`), an unordered, unlabeled list with no per-element metadata, edited client-side as local array state and submitted as a full-list replace (`src/components/admin/event-form.tsx`). That is exactly the shape the treasurer asked for ("a simple list of addresses — NOT labelled contact rows, NOT a primary/alternate pair"), so `ledger_donors.emails text[]` reuses an established pattern rather than introducing a first-of-its-kind one. A child table (`ledger_donor_emails`) was rejected: it would be the right call if emails ever needed labels, ordering, verification status, or per-address audit history, but none of that was asked for, and a child table would add a join to every donor read plus a second CRUD surface for zero behavioral gain over the array. Revisit if the future emailing feature needs per-address delivery status (bounce tracking, etc.) — that would tip the balance toward a child table.

**Old `email` column: dropped, not retained.** Found every reader before dropping it (see the "Files Modified" list above — two API routes, `listDonors()`, and five UI files). All were migrated in this same change, so nothing references the old scalar column post-migration. Retaining it alongside `emails` was rejected — it would either drift out of sync with the list (if left write-only) or force every writer to maintain both fields in lockstep for no benefit, and the treasurer's ask was explicitly to replace, not to add a field.

**Migration idempotency verification (against the dev DB behind `DATABASE_URL` in `.env.local` — never `PROD_DATABASE_URL`).** Before touching anything: queried `ledger_donors` directly and found one dev-only row ("Jane Doe", `email = 'jane@example.com'`) — a real non-null case, unlike production's single NULL-email row, making it a better backfill test. Ran `pnpm db:migrate` (which replays every migration file, 0001 through 0077) once — succeeded, and a follow-up query showed `emails = ['jane@example.com']`, the `email` column gone, `emails` `NOT NULL DEFAULT '{}'::text[]`. Ran `pnpm db:migrate` a second time immediately after — completed with zero errors (the migration runner's own NOTICE-level output showed prior statements skipping as already-applied, matching the idempotent design in every other migration in this file); a final query confirmed the row was untouched (same single element, no duplication, no data loss). This proves both halves of idempotency: the second run neither errors nor mutates data.

**Migration number.** Confirmed `0076_ledger_letter_templates.sql` does not exist yet in `drizzle/migrations/` (reserved by the in-flight acknowledgment-letter-generation design, not yet implemented) and `0075` is the latest file on disk — claimed `0077_ledger_donor_emails.sql` as the next free number, no collision.

**Duplicate-within-one-donor decision.** Reject (400/toast), not silent dedupe: both the client (`donor-form.tsx`'s `addEmail()`) and the API (`normalizeEmails()`, duplicated identically in both route files since it's an 8-line pure function with no natural shared-module home smaller than the duplication itself) refuse a case-insensitive duplicate within the same list. Chose reject-over-dedupe so the treasurer always sees exactly what happened rather than a silent no-op that could look like a bug ("I added it, nothing changed, did it work?").

**Cross-donor soft-dedup (POST 409).** Generalized from the old exact (name, email) match to (name, any overlapping address) — checked via `db.query.ledgerDonors.findMany({ where: eq(name, ...) })` then a JS-level `.some()` overlap check rather than a Postgres array-overlap operator (`&&`), since this table is a handful of rows and a JS check is simpler to read and test than introducing `sql`-templated array-overlap SQL for a one-time guard.

**Gates:** `pnpm exec tsc --noEmit` — clean. `pnpm test` — 1148 passed (57 files), up from the 1127 baseline by exactly the 21 new tests added in this change (4 in `ledger-queries.donors.test.ts`, 10 in `donors/route.test.ts`, 7 in `donors/[id]/route.test.ts`), zero regressions. `pnpm build:only` — `✓ Compiled successfully`, exit 0. `pnpm lint` was attempted and failed with a pre-existing, unrelated environment error (`ESLint: ... SyntaxError: The requested module 'minimatch' does not provide an export named 'default'`) — an ESM/CJS interop break in the `eslint`/`@eslint/eslintrc`/`minimatch` toolchain itself, reproducible on a clean checkout with no files from this change touched; flagging for the deployment-engineer's 30-day dependency review rather than fixing here (out of scope for a donor-emails feature, and CLAUDE.md's stated gates for this pipeline step are typecheck + test + build, not lint).

**Not done (explicitly out of scope, per task constraints):** no `sendEmail()` wiring, no changes to the acknowledgment-letter-generation work-log or any file it names, no changes under `scripts/`.

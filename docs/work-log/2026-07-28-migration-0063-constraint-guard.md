# 0063 budget-lines constraint re-add breaks deploy once a cause has multiple labels — Work Log

> **Slug:** `2026-07-28-migration-0063-constraint-guard`
> **Surface:** deploy / DB migration
> **Estimated complexity:** small (deploy hotfix)
> **Pipeline mode:** Bug-fix variant — architect/tech-lead skipped (one-line migration idempotency guard); qa done inline (local migration replay)

## Root cause
Migrations re-run every deploy. `0063_ledger_budget_lines.sql` re-adds
`ledger_budget_lines_budget_cause_key` UNIQUE `(budget_id, cause)` on every run;
`0064_ledger_budget_line_labels.sql` (v1.41.0) drops it and adds
`ledger_budget_lines_budget_cause_label_key` UNIQUE `(budget_id, cause, label)`. Harmless
until real data had multiple labeled lines under one cause. Applying the FY2026 Foundation
budget seed (2026-07-28) created that shape in prod — after which the v1.42.1 deploy's `0063`
re-add hit `(budget_id, cause)=(…, Hunger & Basic Needs) is duplicated` and aborted the build.

## Reproduction
Prod build log 2026-07-28 11:07 (commit 57d90a2): `❌ Migration failed: could not create
unique index "ledger_budget_lines_budget_cause_key" … is duplicated`. Local repro: local dev
DB already carries the label constraint (migrated state); the old `0063` would attempt the
`(budget_id, cause)` re-add on any DB where `0064` had dropped it, failing once duplicate-cause
rows exist.

## Fix
`0063`'s `ADD CONSTRAINT ledger_budget_lines_budget_cause_key` DO-block now also requires that
`ledger_budget_lines_budget_cause_label_key` does NOT exist. On a migrated DB the guard is
false → the obsolete constraint is never re-added → replay is a clean no-op. Fresh DB: label
key absent when `0063` runs → old key added as before → `0064` swaps it.

## Verification
- Guard-logic SELECT on local (label key present) → `would_add_old = f`.
- `pnpm db:migrate` against local (migrated state) → `✅ Migrations completed successfully`,
  `0063`/`0064` both clean.
- No app-code change; tsc/tests/build unchanged from v1.42.1 (all green).

## Phases skipped
Architect + tech-lead skipped (trivial, well-scoped migration idempotency guard). Analyst
skipped (deploy hotfix, not a user-facing behavior change). Documented per bug-fix variant.

## Follow-up
Migration review: scan for any other migration that ADDs a UNIQUE/constraint a LATER migration
drops/replaces — same latent "re-add fails once data diverges" trap. (No others found in a
quick pass, but worth a deliberate sweep.)

# Itemized Sweep Increment 2a: Sweep Batch Core (Schema, Decision Group, Locks, Void) — Work Log

> **Slug:** `2026-10-17-itemized-sweep-inc2a-sweep-batch-core`
> **Parent:** `docs/work-log/2026-10-16-itemized-sweep-public-funds.md` (B-172, Itemized sweep and Public Funds; Phases 1 to 3 live there)
> **Reserved IDs:** migration number re-derived at Phase 4 start (placeholder `0116`); B-190 and B-194 close inside this increment (server side for B-190); B-195 lands here; next free id after this feature is B-198
> **Surface:** (dashboard) admin: The Ledger (API and library; no builder UI; Approvals page unchanged except via query-derived fields)
> **Permission(s):** no new `FEATURES` key (existing `ledger.record`, `ledger.manage`, `ledger.approve`, `ledger.view`)
> **Estimated complexity:** large
> **Pipeline mode:** Full, increment of a multi-increment feature. Phases 1 and 2 done in parent; Phase 3 designed in parent, Increment 2a (contract level; this work-log opens at Phase 4 after a short Phase 3 confirmation against the as-built Increment 1)
> **Migration:** Yes: one (placeholder `0116`): `swept_from_txn_id`, `sweep_leg_txn_id`, the partial unique index, `ledger_sweep_closeouts`, the `Transfer to Foundation` seed
> **Phase 4/5 environment:** `isolation: "worktree"` cut from main AFTER Increment 1 is merged (the batch copies the mirror category), with its own Neon dev branch; positional `neonctl` branch id and host comparison before any write. Increment 2b reuses this worktree and branch.
> **Depends on:** Increment 1 merged to main (`mirrors_category_id` must exist). Does not ship alone in practice: ship with 2b (no UI reaches its routes; the lump path stays open until 2b).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Done in parent (see 2026-10-16-itemized-sweep-public-funds.md) | READY WITH NOTES | 2026-10-16 |
| 2 — Architectural review | architect | Done in parent (see 2026-10-16-itemized-sweep-public-funds.md) | Approved with suggestions | 2026-10-17 |
| 3 — Technical design | tech-lead | Done in parent (see 2026-10-16-itemized-sweep-public-funds.md, "Phase 3 — Technical Design", Increment 2a) | Design complete | 2026-10-17 |
| 4 — Implementation | database-admin → api-developer (then qa) | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending (one Phase 6 for B-172, after Inc 2b) | — | — |

---

# Phases 1 to 3

**Phase 1 (analyst):** Done in parent (see `2026-10-16-itemized-sweep-public-funds.md`, "Phase 1 — Functional Refinement").
**Phase 2 (architect):** Done in parent (see `2026-10-16-itemized-sweep-public-funds.md`, "Phase 2 — Architectural Review").
**Phase 3 (tech-lead):** the design for this increment is in the parent's "Phase 3 — Technical Design", Increment 2a; read "Rulings that differ from Phase 1/2 (read first)" before anything else. DECISION-126 and DECISION-127 are in `docs/decisions.md` (Proposed; promoted at Phase 6).

## Scope of this increment

Pointer columns and partial unique index; `ledger_sweep_closeouts`; `ledger-sweep.ts` carrier; `ledger-sweep-link.ts`; `ledger-sweep-batch.ts` (`evaluateSweepBatch`, create, void, candidates, closeouts); `classifyDecisionGroup` and `lockDecisionGroup`; the decision and co-sign generalization; the three lock kinds in every guard; receipt suppression and B-194; the extracted approver notifier; B-195 constant move; five routes; `Transfer to Foundation` seed. Live checks S3 to S10. The break-site list in the parent's Phase 3 (15 entries) is the checklist.

## Start-of-Phase-4 checklist

- Re-derive the next free migration number (`ls drizzle/migrations/*.sql | sort | tail -3`); the tail was `0114` on 2026-10-17 and the parent's `0115`/`0116` are placeholders.
- Confirm in a first read that `ledger_filings` IRS rows carry the 990-family titles before relying on `period_filed`; confirm the register does not crash on a leg row with no income partner.
- Scratch space: `<scratchpad>/<pipeline-slug>/`; never kill or restart the `:3000` dev server (ask the orchestrator); no agent writes the production database (Workflow Rule 10).
- Keep every file free of personal data: category and fund names only, placeholder amounts, `example.invalid`.
- Record "Deviations from the design" at the end of Phase 4, routed by size per the scope-routing rule in CLAUDE.md.

---

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Migration file: `drizzle/migrations/NNNN_*.sql` (idempotent)

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

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

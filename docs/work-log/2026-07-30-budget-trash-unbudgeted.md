# Trash on an unbudgeted category silently did nothing — Work Log

> **Slug:** `2026-07-30-budget-trash-unbudgeted`
> **Surface:** (dashboard) admin — `/admin/ledger/budgeting`
> **Permission(s):** existing `LEDGER_MANAGE` / `BUDGET_EDIT` gate on `PATCH /api/admin/ledger/budgets` — unchanged
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | full-stack-developer (brief) | Complete | Bug confirmed, fix preserves intent | 2026-07-30 |
| 2 — Architectural review | — | Skipped | No new directories/deps/structural change; extends an existing soft-delete write path | 2026-07-30 |
| 3 — Technical design | full-stack-developer (brief) | Complete | See "Design decisions" below | 2026-07-30 |
| 4 — Implementation | full-stack-developer | Complete | See Phase 4 section | 2026-07-30 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Phase 1 (brief) — Bug confirmed

**Report (Chris, treasurer):** clicking the trash can on a budgeting-page category that has **no amount entered** does nothing — no toast, no visible change, no network call.

**Root cause:** `requestRemove` (`src/components/admin/ledger/budget-editor.tsx`) always resolves through `resolveBudgetLineDeleteAction(line.budgetCents !== null, "")` (`src/lib/ledger.ts`) before firing the `PATCH { pendingDelete: true }` call. `resolveBudgetLineDeleteAction` returned `"noop"` whenever `hasExistingRow` was `false` — i.e. whenever the category has no `ledger_budgets` row for this FY yet (`budgetCents === null`). `requestRemove` early-returns on `"noop"`, so the trash icon (rendered unconditionally whenever `showRemoveControl && !disabled`, with no gate on `budgetCents`) silently does nothing for any never-budgeted category. Same latent bug on the in-breakdown trash entry point (routes through the same `requestRemove`, via a `ConfirmDialog`).

**Desired behavior confirmed with Chris:** clicking trash on ANY category — budgeted or not — marks it pending-delete: struck through with a Restore control, purged only on Approve & lock. Exactly the existing budgeted-category behavior.

**Reproduction (pre-fix):**
1. `/admin/ledger/budgeting`, open any fund/FY with a category that has never had a budget amount entered.
2. Click the trash icon on that row.
3. Nothing happens — no PATCH fires, row stays exactly as it was.

## Phase 2 — Skipped

No new directories, npm dependencies, or structural change. This extends the existing soft-delete/restore write path (`setBudgetLinePendingDelete`, DECISION-052/053) that was already the "single soft-delete/restore write path" per its own doc comment — no invariant is newly touched, just widened to cover a case it previously 404'd/no-op'd on.

## Phase 3 (brief) — Design decisions

1. **Client:** `resolveBudgetLineDeleteAction` gains a third return value, `"create-then-delete"`, for the `hasExistingRow: false` + blank-raw-value case (previously `"noop"`). `requestRemove` already only branches on `!== "noop"`, so no other client logic needed to change — the SAME `PATCH { pendingDelete: true }` call now fires for both the soft-delete and create-then-delete cases. `commitValue`'s blur/Enter gesture only branches on `=== "soft-delete"` and falls through to its own blank-check for anything else, so the blur-then-blank gesture on a never-touched field is UNCHANGED (still a true no-op, no network call) — the rename doesn't alter its behavior.
2. **Server:** `setBudgetLinePendingDelete` (`src/lib/ledger-queries.ts`) now lazily creates a `$0` `ledger_budgets` row (mirroring `setBudgetCategoryAnnotation`'s existing lazy-create precedent) already marked `pending_delete_at`, instead of 404ing, when `pendingDelete: true` targets a tuple with no existing row. `pendingDelete: false` (restore) is UNCHANGED for a missing row — still 404s (defensive; unreachable via the UI, since Restore only renders for an already-pending-delete row).
3. **Restore of a lazily-created row — the orphan-avoidance decision:** there's no stored flag distinguishing "lazily created $0" from "a treasurer's deliberate $0 budget that was later trashed" without a schema change (out of scope — this is a state-flag fix on an existing table, not a new column). Decision: restore HARD-deletes the row whenever `annualAmountCents === 0`, rather than just clearing the flag. This satisfies "leaves no orphan $0 rows" for the common case (an unbudgeted category restores to truly unbudgeted, not a visible $0 line nobody entered) at the cost of a documented, rare edge case: a category deliberately budgeted at exactly $0, then trashed, then restored, comes back unbudgeted rather than $0. Judged acceptable — $0-budgeted and unbudgeted are financially equivalent for reporting, and no other restore path ever changes `annualAmountCents` (soft-delete always preserves the number; only THIS one $0 branch changes it).
4. **Client-side consequence of #3, caught by the e2e test (see Phase 4):** because restore of a $0 row is the ONE case where `annualAmountCents` actually changes on restore (every other restore is a pure flag-clear, so whatever stale value `inputs[key]` already holds stays correct), `setPendingDelete` in `budget-editor.tsx` now reads the server's `action` in its response and blanks `inputs[key]` locally when `action === "deleted"` — otherwise the UI could show a stale "0.00" until the next full remount.

## Scope boundary (explicit — do not silently over-reach)

This fix makes the trash icon **work** (strikethrough-until-finalize) for a category with no budget row. It does **not** permanently retire the category from the catalog: an active category with no budget row still reappears as a blank line in a future FY. Permanent category removal is a separate, already-in-design feature — kept out of scope here per the task brief.

---

# Phase 4 — Implementation (full-stack) — 2026-07-30

**Owner:** full-stack-developer
**Status:** complete

### Summary

Fixed the trash-on-unbudgeted-category no-op. `resolveBudgetLineDeleteAction` (`src/lib/ledger.ts`) now resolves the no-existing-row + blank case to `"create-then-delete"` instead of `"noop"`; `setBudgetLinePendingDelete` (`src/lib/ledger-queries.ts`) lazily creates a `$0` pending-delete row instead of 404ing, and hard-deletes a `$0` row on restore instead of leaving an orphan. `budget-editor.tsx`'s `setPendingDelete` was also updated to blank the local input when the server reports the restore actually deleted the row (a client-side gap the e2e test caught).

### What I did

- Traced the root cause per the diagnosis in the task brief and confirmed it in `resolveBudgetLineDeleteAction` / `requestRemove`.
- Widened `resolveBudgetLineDeleteAction`'s return type to `"soft-delete" | "create-then-delete" | "noop"`; updated its doc comment to explain why the blur-driven `commitValue` path's behavior is unaffected.
- Widened `SetBudgetLinePendingDeleteResult["action"]` to include `"deleted"`; `setBudgetLinePendingDelete` now:
  - Lazy-creates (`insert().onConflictDoUpdate()`, race-safe) a `$0` row already marked `pending_delete_at` when `pendingDelete: true` targets a missing tuple.
  - Still 404s for `pendingDelete: false` (restore) against a missing tuple (unchanged, defensive-only).
  - Hard-deletes the row on restore when `annualAmountCents === 0` (orphan avoidance), returning `action: "deleted"`; otherwise unchanged (pure flag-clear, `action: "restored"`).
- Updated `budget-editor.tsx`: `requestRemove`'s doc comment (no logic change needed — it already only special-cases `"noop"`); `setPendingDelete` now reads the response body and blanks `inputs[key]` locally when `action === "deleted"`.
- Added Vitest coverage:
  - `resolveBudgetLineDeleteAction`: blank + no-existing-row → `"create-then-delete"` (was `"noop"`), plus a whitespace-only variant.
  - `setBudgetLinePendingDelete`: (a) lazy-create on soft-delete against a missing row, (b) restore hard-deletes a `$0` row, (c) restore of a non-zero row is unaffected (still a pure flag-clear, byte-for-byte amount preserved). Updated the pre-existing "returns 404 when no row exists" test to `pendingDelete: false` only, since `pendingDelete: true` against a missing row no longer 404s by design.
- Added an e2e regression test to `e2e/budgeting-restructure.spec.ts`: creates a brand-new, uniquely-named category (rather than reusing an existing catalog category, to avoid depending on this suite's already-known non-idempotent FY2099 fixture state — see below), clicks trash while it's genuinely unbudgeted, asserts the struck-through/Restore-able state (both immediately and after a full reload, proving server persistence), then restores and asserts it's back to a truly blank row (both immediately and after a reload, proving no orphan `$0` row).
- Ran `pnpm exec tsc --noEmit` (clean) and `pnpm test` (837/837 passing) after every substantive change.
- Ran the new e2e test in isolation (`playwright test e2e/budgeting-restructure.spec.ts -g "bug fix 2026-07-30"`) against the local dev server — passes.

### Outputs

- `src/lib/ledger.ts` — `resolveBudgetLineDeleteAction`: return type widened, `"noop"` → `"create-then-delete"` for the no-existing-row + blank case; doc comment rewritten.
- `src/lib/ledger.test.ts` — 2 new tests under `describe("resolveBudgetLineDeleteAction")`.
- `src/lib/ledger-queries.ts` — `setBudgetLinePendingDelete`: lazy-create-on-missing-row branch (soft-delete direction only), `$0`-hard-delete-on-restore branch; `SetBudgetLinePendingDeleteResult["action"]` widened with `"deleted"`; doc comment rewritten with the orphan-avoidance tradeoff spelled out.
- `src/lib/ledger-queries.test.ts` — updated the pre-existing "no row exists" 404 test to `pendingDelete: false` only; added 3 new tests (lazy-create on soft-delete, restore hard-deletes a `$0` row, restore of a non-zero row is unaffected).
- `src/components/admin/ledger/budget-editor.tsx` — `requestRemove` doc comment updated (no logic change); `setPendingDelete` now reads `action` from the PATCH response and blanks `inputs[key]` when `action === "deleted"`.
- `e2e/budgeting-restructure.spec.ts` — 1 new test: `"bug fix 2026-07-30: trash on a category with NO budgeted amount marks it pending-delete (Restore-able), not a silent no-op"`.
- No schema change, no migration, no new `FEATURES` entry, no new env var — this is a state-flag fix on an existing table (`ledger_budgets.pending_delete_at`, already nullable with no default).

### Open questions / handoff notes

- **Environmental observation, unrelated to this fix:** while verifying, a full run of `e2e/budgeting-restructure.spec.ts` failed at an EARLIER, pre-existing test (`Flow 7`) because the shared local-dev FY2099 fixture is already dirty — `"Charitable donation out"` is no longer in its expected fresh lump-sum state, and separately `e2e/budget-star-notes.spec.ts`'s FY2099 fixture (Club entity) shows a similar symptom (`"Vision screening"` already starred). Both suites' own doc comments already document that FY2099 needs a manual DB cleanup between runs (`budget-star-notes.spec.ts`: "QA cleans up FY2099... via a direct DB delete after this suite finishes running") that appears not to have happened after a prior run. **This is pre-existing, not caused by this fix** — neither failing test touches any code path this fix changed (trash/restore controls, `setPendingDelete`, `resolveBudgetLineDeleteAction`). Confirmed by running the new regression test in isolation via `-g`, which passes cleanly, and by the full Vitest suite (837/837) passing. Flagging for qa: the local dev FY2099 fixture likely needs the documented manual cleanup before a full run of either e2e suite will pass end-to-end again.
- **What to test in the browser (beyond the e2e coverage above):** click trash on a real never-budgeted category on a real (non-FY2099) fund/FY as an admin with `LEDGER_MANAGE`/`BUDGET_EDIT` — confirm strikethrough + Restore appear immediately, Restore returns it to a blank row, and a locked budget still refuses both directions (409, "This budget is locked...") for an unbudgeted category exactly as it already does for a budgeted one (the lock check is unchanged — runs before the lazy-create branch).
- Nominating **qa** for Phase 5.

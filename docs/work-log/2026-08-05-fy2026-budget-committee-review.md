# FY2026 Budget-Committee Review Applied — Work Log

> **Slug:** `2026-08-05-fy2026-budget-committee-review`
> **Surface:** (dashboard) admin — The Ledger budgeting (**data only**; no schema, API, or UI change)
> **Permission(s):** none — one-off treasurer-run `tsx` script against the DB, not a user-facing feature. Trust model is direct DB credentials held by the treasurer, same as `scripts/backfill-check-numbers.ts` and `scripts/seed-fy2026-foundation-budget.ts`.
> **Estimated complexity:** small
> **Pipeline mode:** Operational-script mode — **Phases 1, 2, 3, and 6 skipped explicitly** (rationale below). No silent skips.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | — | Skipped — no feature request. The "requirements" are a budget committee's line-item feedback on a draft budget; the treasurer is the decision-maker, and the decisions are recorded below rather than refined by an analyst. | — | — |
| 2 — Architectural review | — | Skipped — no new directory, dependency, schema, route, or component. Touches only existing `ledger_*` rows. No invariant is in play. | — | — |
| 3 — Technical design | — | Skipped — the change set was fully specified by the committee email plus the treasurer's rulings before the script was written; the script header is the design doc. | — | — |
| 4 — Implementation | treasurer (Chris) | Complete — `scripts/apply-fy2026-budget-review.ts` written and run with `--apply` against production | applied | 2026-08-05 |
| 5 — Verification | treasurer (Chris) | Complete — dry run, transactional apply with a hard-fail rollup assertion, then a clean re-run to prove idempotency | PASS | 2026-08-05 |
| 6 — Shipped vs intent | — | Skipped — nothing shipped to users. The output is budget data the board reviews on paper and in `/admin/ledger/budgeting`; the board review itself is the sign-off, and the open questions carried into the Notes & Assumptions are the handoff. | — | — |

---

## Trigger

Lori Lampel (budget committee) reviewed the draft FY2026 budget by email on **2026-08-05** and returned feedback on both the Foundation's Charitable fund and the Club's Administrative fund. Two items drove most of the work:

- She could not find the benches program anywhere in this year's budget.
- WARM had dropped out of the draft entirely, and she recommended adding Husky Hub.

The FY2026 budget was still in **draft (unlocked)** state for both entities, so all edits landed in the draft — no approved budget was rewritten. The script refuses to run at all if either entity's FY2026 budget is locked.

---

## Treasurer's decisions

Three judgment calls sit behind the applied changes.

1. **Rename the category rather than only annotating it.** The generic Foundation charitable category "Program supplies" *is* the benches program — all 6 transactions ever posted to it are tagged `beneficiary_cause = "Bags to Benches (Recycling)"`. A note alone would have left the line unfindable in the budget, which was Lori's actual complaint. It was renamed to **"Bags to Benches"**, and the script asserts the zero-stray-transaction condition live before renaming rather than trusting the pre-check.

2. **WARM at $2,000, as the committee asked — not the $4,500 actually given.** FY2025 budgeted $1,000 for WARM but actual giving was $4,500 ($2,500 Share Bac a Pac in Aug 2025 plus $2,000 in Jan 2026). The treasurer applied the committee's recommended $2,000 rather than silently sizing the line to prior-year actuals, and put the gap in the line note and in the board-review section of the Notes & Assumptions so the board can raise it deliberately.

3. **Describe the duplicate-category problem for the board rather than resolving it unilaterally.** The Club budgets $200 under "Awards" (no transactions ever) while $490.48 of member recognition posted to a separate "Member recognition" category; likewise $75 under "Supplies" versus $670.64 in a separate "Program supplies". Merging either pair changes what the board approved last year and picks a winning name — a board decision, not a treasurer edit. **No Club amounts were changed.** The pairs are documented on the line notes and as two numbered open questions in the Club Notes & Assumptions.

---

## What was applied (production, FY2026 draft)

Source of truth for the exact change set: the header comment of `scripts/apply-fy2026-budget-review.ts`.

**Foundation / Charitable**

- Category **"Program supplies" → "Bags to Benches"**; the $200 line noted as the benches program (plaques + plastic bags), with the FY2025 comparison ($200 budgeted, $146.38 actual).
- **WARM (Westerville Area Resource Ministry) restored at $2,000** as a cause line under *Charitable donation out / Hunger & Basic Needs*.
- **Husky Hub (Heritage Middle School) added at $500** under the same category and cause — the Heritage Middle School food bank, matching last year's $500 gift made through the Heritage Middle School PTSA.
- Parent **"Charitable donation out" rolled up $23,175 → $25,675** (recomputed as `SUM(children)`, the same way `createBudgetCauseLine` does in `src/lib/ledger-queries.ts`).
- **OLF Eye Care Fund** and **Prevent Blindness Ohio** cause lines got board-facing rationale notes covering the $1,000 → $500 OLF reduction and the former "Local Eyecare Assistance" → PBO shift, plus the standing clarification that the OLF Eye Care Fund is not the Ohio Lions Eye Research Fund (separately funded on its own $750 line).
- **Foundation FY2026 totals now: income $38,900, expense $45,512, net −$6,612** (expense was $43,012, net was −$4,112).

**Club / Administrative — commentary only, no amounts changed**

- **Per-capita tax** noted as merging Lions Clubs International dues, District dues, and new-member entrance fees into one line, with the FY2025 composition.
- **Awards** and **Supplies** noted to point at their real-spend twins ("Member recognition", "Program supplies").

**Both entities**

- **Notes & Assumptions rewritten in Markdown**, each with a "Budget-committee review — August 5, 2026" section carrying the open questions to the board: eye-care rationale, the WARM level, Husky Hub's cause placement, and (Club side) the two duplicate-category questions.

`ledger_transactions` was never touched. The only amount changes anywhere are the two new Foundation cause lines and the parent rollup they imply.

---

## Verification

- **Dry run first** (no `--apply`) — the script prints its full plan, including whether each cause line would insert or update and the before/after parent total.
- **Transactional apply** — every write runs inside a single `sql.begin` block. Before the parent rollup is written, the script re-reads `SUM(amount_cents)` across the category's cause lines and compares it to the expected $25,675; a mismatch throws and rolls the whole transaction back rather than committing a parent total that disagrees with its children.
- **Pre-write guards** — refuses on a locked FY2026 budget; refuses if a second "Bags to Benches" category already exists; refuses if any transaction on the renamed category is not tagged Bags to Benches; and asserts every note/label/notes string against the app's own length limits (500 / 120 / 4000) so the script can never seed text the UI would later refuse to save.
- **Post-apply readback** — the script prints the two Foundation category totals, the Hunger & Basic Needs cause lines, and the recomputed Foundation FY2026 income/expense/net.
- **Re-run confirmed idempotent** — running the script a second time produced no further changes (the rename is a no-op, both cause lines take the `ON CONFLICT … DO UPDATE` path to the same amounts, and the rollup writes the same value).

---

## Follow-ups

Filed in `docs/treasurer-todo.md`:

- **T-27** — possible duplicate $102.86 posting on 2026-06-10 (used-eyeglass collection boxes).
- **T-28** — WARM budget-vs-actual gap; board to confirm the FY2026 level.
- **T-29** — duplicate/parallel Club categories (Awards vs. Member recognition; Supplies vs. Program supplies).
- **T-30** — Husky Hub cause placement (Hunger & Basic Needs vs. Youth & Education).

Related: **T-25** (category-catalog cleanup) covers the same family of problem on the Foundation side — T-29 is the Club-side instance and should be decided alongside it.

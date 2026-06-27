# Agent & Instruction Review — 2026-06-27

**Outcome:** 4 medium, 2 low, 2 informational findings. The pipeline is earning its keep — 9 cycles in 31 days, specialist split is real and working, qa is catching real defects. Two MUST edits from the prior retros (2026-05-27 × 2, 2026-06-24 × 2) remain unapplied. One new MUST finding (qa unit-test gap recurred twice). One stale package reference in `architect.md`.

---

## Scope

Files examined:
- `.claude/agents/` — all 9 agent files
- `.claude/skills/add-permission/SKILL.md`, `pre-push/SKILL.md`, `release-notes/SKILL.md`, `neon-postgres/SKILL.md`, `new-feature/SKILL.md`
- `CLAUDE.md` — Agent Roster, Development Pipeline, Periodic Reviews, Key Invariants sections
- `docs/work-log/` — all 7 new entries since 2026-05-27 (dues tracking through ledger-donors-integrations)
- `docs/reviews/log.md` — prior entry summary
- `docs/reviews/2026-05-27-agent-instruction.md` — prior cycle findings (baseline)
- `docs/reviews/2026-06-24-retrospective.md` — most recent retrospective
- `docs/decisions.md` — implementation/architectural decision log

---

## Prior Cycle Carry-Forwards: Status Check

These were proposed in 2026-05-27 and 2026-06-24 retros and are now re-assessed:

| Proposed Edit | Source | Status |
|---|---|---|
| qa: Feature-gate audit section | retro-2026-05-27 MUST | APPLIED (commit 00339f3) |
| pre-push: CVE audit step | retro-2026-05-27 MUST | APPLIED (commit 00339f3) |
| CLAUDE.md: full-stack-developer as default implementer note | retro-2026-05-27 SHOULD | NOT APPLIED |
| CLAUDE.md: deployment-engineer is reactive, not a mandatory gate | retro-2026-05-27 SHOULD | NOT APPLIED |
| CLAUDE.md: merge doc + agent reviews into one | retro-2026-05-27 COULD | NOT APPLIED |
| CLAUDE.md: Workflow Rule — no force-push to diagnose external systems | retro-2026-06-24 MUST | APPLIED (commit visible in CLAUDE.md §8) |
| deployment-engineer.md: get ground truth before acting; known Vercel failure modes | retro-2026-06-24 MUST | APPLIED (visible in deployment-engineer.md §External-System Failures) |
| CLAUDE.md: Vercel duplicate-account gotcha | retro-2026-06-24 SHOULD | APPLIED (CLAUDE.md Gotchas visible) |
| CLAUDE.md: full-stack-developer as default (carry-forward) | retro-2026-06-24 SHOULD | NOT APPLIED |
| CLAUDE.md: deployment-engineer is reactive (carry-forward) | retro-2026-06-24 SHOULD | NOT APPLIED |
| e2e: annotate or fix known-failing cancel-occurrence / write-in-signups tests | retro-2026-06-24 SHOULD | NOT ASSESSED (out of scope for this review) |
| CLAUDE.md: Bug-Fix Variant — require minimal work-log stub | retro-2026-06-24 COULD | NOT APPLIED |

**Summary of applied MUSTs:** All four MUSTs from the two prior retros are now applied. Three SHOULD carry-forwards remain open.

---

## Findings

### Finding 1 — qa.md does not require implementers to deliver Phase-3-specified unit tests; qa catches the gap instead (recurrence pattern)
**Location:** `qa.md`, `docs/work-log/2026-06-24-ledger-books.md` (inc1), `docs/work-log/2026-06-26-ledger-donors-integrations.md` (inc6a)  
**Severity: MEDIUM — recurring gap with low-cost fix**

**Observation:** Across the 7 new Ledger work-logs, qa caught missing unit tests in at least two increments:

- **Inc1 (2026-06-24):** `determine990()` had zero unit coverage. Phase 3 explicitly required tests. qa wrote 11 tests to close the gap.
- **Inc6a (2026-06-26):** `dues-ledger-sync.ts` had zero unit tests. Phase 3 explicitly required 14 tests (for `syncDuesCreate`, `syncDuesUpdate`, `syncDuesDelete`). The api-developer Phase 4b section says "TypeScript clean, 279 tests green (12 new)" — but the 12 new tests were for `ledger.ts` (deriveAckType + guardrail), not for `dues-ledger-sync.ts`. qa wrote all 14 sync tests.

The root pattern: the api-developer writes tests for existing modules but misses the new cross-cutting module. The Phase 3 design called the tests out by name; the implementer delivered the code but not the tests; qa caught it.

This is not a qa failure — qa caught the gap both times and the pipeline worked. But it is a recurring implementer gap. The fix is cheap: add a checklist item to `api-developer.md` and `full-stack-developer.md` that says "if Phase 3's design doc requires specific unit tests, verify they are written before marking Phase 4 complete."

**Suggested correction (MUST — recurred twice):**

In `api-developer.md` → Core Responsibilities section, after the existing list of responsibilities, add:

> **Phase 3 test deliverables.** Before marking Phase 4 complete, read the Phase 3 design doc and confirm every unit test it names as a deliverable is written and passing. If the design requires "Vitest unit tests for X," those tests must exist before handoff to qa. qa writes regression tests; it does not write the implementer's deliverables.

In `full-stack-developer.md` → Standards section, add an analogous note:

> **Phase 3 test deliverables.** If the Phase 3 design doc specifies unit tests by name, write them before marking Phase 4 complete. qa adds regression coverage; it does not substitute for implementation-phase tests.

---

### Finding 2 — `architect.md` lists `xlsx` as an "already available" dependency; it was replaced with `exceljs` in v1.18.5
**Location:** `architect.md` → Dependency Evaluation Criteria → "Already available" list  
**Severity: MEDIUM — will send implementers to a replaced package**

**Observation:** Line 87 of `architect.md` lists `xlsx` in the "Already available" package list. The 2026-05-27 dependencies review found xlsx's CVEs unfixable and recommended replacement with `exceljs`. The replacement was done in v1.18.5 (commit `3da44ad`). `exceljs` is now in `package.json`; `xlsx` remains only as a devDependency for scripts. Any future implementer reading the `architect.md` "already available" list will see `xlsx` as available and may reach for it instead of `exceljs`.

**Suggested correction (MUST):**

In `architect.md` → "Already available" list:
- Replace `xlsx` with `exceljs`
- If `xlsx` needs to remain for scripts-only context, append: `` `xlsx` (devDep — scripts only; use `exceljs` for new app code) ``

---

### Finding 3 — Four SHOULD carry-forwards from prior retros remain unapplied (2 cycles)
**Location:** `CLAUDE.md` — Phase 4 implementer table, Agent Roster table, Bug-Fix Variant  
**Severity: MEDIUM — no real-world harm yet, but these become harder to apply as the project grows**

The three SHOULD items from prior retros are:

**3a — full-stack-developer as default implementer (CLAUDE.md Phase 4 table)**

Evidence from this cycle: every Ledger increment ran db-admin → api-developer → ux-developer rather than full-stack-developer — which is actually the *opposite* of the "full-stack is default" hypothesis. The specialist split is now the de facto path for large, multi-layer features. The "150-line threshold" in `full-stack-developer.md` is the right heuristic; what's missing from CLAUDE.md is that the specialist split is the standard path for features of Ledger's size. The proposed note from prior retros should be updated to reflect this nuance: full-stack is the default for *small* features; for anything touching a new schema + a new API surface + new pages, the specialist path is expected.

**3b — deployment-engineer is reactive in CLAUDE.md (Agent Roster table)**

The Agent Roster still says `| **deployment-engineer** | Pre-deploy | Production build verification, env vars, build failures. |`. This phase label "Pre-deploy" is inconsistent with reality: `/pre-push` covers the pre-deploy checklist; deployment-engineer is invoked reactively for build failures, Vercel diagnostics, and the 30-day dependency review.

**3c — Bug-Fix Variant: require minimal work-log stub**

The donate-fix (v1.18.6, 2026-06-24) still has no work-log entry. The recommendation to require a minimal stub remains valid and unapplied.

**Suggested corrections (carry-forward SHOULD — escalating to MEDIUM given 2-cycle accumulation):**

3a: In `CLAUDE.md` → Phase 4 → Implementer selection table, add after the table:
> For large features (new schema + API surface + UI pages, as in the Ledger increments), use the full specialist path: **database-admin** → **api-developer** → **ux-developer**. For small, tightly coupled changes (~< 150 lines across server + client), use **full-stack-developer**. When in doubt about scope, start with the specialist path — over-splitting adds one handoff; under-splitting produces a sprawling full-stack PR.

3b: In `CLAUDE.md` → Agent Roster, change deployment-engineer row to:
> `| **deployment-engineer** | Reactive | Build failures, env-var changes, Vercel diagnostics — invoked on demand, not as a mandatory pipeline phase. `/pre-push` covers the pre-deploy checklist. |`

3c: In `CLAUDE.md` → Bug-Fix Variant, add a note:
> Even for trivial fixes, create a minimal work-log stub at `docs/work-log/YYYY-MM-DD-<slug>.md` recording: root cause (one sentence), fix shape (one sentence), which phases were explicitly skipped and why. A 5-line stub enables the next retrospective without requiring a commit-diff archaeology session.

---

### Finding 4 — Migration number collision is a recurring risk; no guidance exists in database-admin.md or CLAUDE.md
**Location:** `docs/work-log/2026-06-25-ledger-reports.md`, `database-admin.md`  
**Severity: LOW**

**Observation:** The Phase 2 architect for ledger-reports proposed `0048_ledger_990_lines.sql`. By the time database-admin ran Phase 4, `0048_ledger_compliance.sql` already existed from the compliance increment that ran concurrently. The database-admin caught this ("Confirmed `0048_ledger_compliance.sql` exists → migration must be `0049_ledger_990_lines.sql`") and self-corrected. No harm done. But the collision was caused by the architect proposing a migration number without checking the current `drizzle/migrations/` directory.

The risk scales with the number of parallel increments. When two increments are in-flight simultaneously (compliance + reports both proposed 0048), the architect in Phase 2 cannot safely predict the migration number because another increment may claim it first.

**Suggested correction (LOW):**

In `database-admin.md` → Core Responsibilities → Migrations section, add:

> **Migration number assignment:** Do not trust the migration number proposed in Phase 2 or Phase 3 — those numbers were assigned when those phases ran, and a parallel increment may have claimed the same number since. Always run `ls drizzle/migrations/*.sql | sort | tail -3` at the start of Phase 4 to determine the actual next number.

In `architect.md` → when authoring Phase 2 output, add a note:

> When proposing a migration filename, note that the number is tentative — a parallel feature may have claimed it before Phase 4 runs. The database-admin must verify the actual next free number at implementation time.

---

### Finding 5 — The `add-permission` skill Step 6 still contains the stale "if CLAUDE.md maintains a feature/permission inventory" sentence
**Location:** `.claude/skills/add-permission/SKILL.md` line 105  
**Severity: LOW**

This was Finding 3 from the 2026-05-27 review — it was not applied. The conditional "if `CLAUDE.md` maintains a feature/permission inventory, add the new row" still exists. CLAUDE.md has no such section and never has. The skill was used multiple times this cycle (add-permission ran at least once per Ledger increment for new permissions) and the false conditional caused no harm — but it points the reader at a section that doesn't exist.

**Suggested correction (LOW — carry-forward, same as May):**

Remove line 105: `- If \`CLAUDE.md\` maintains a feature/permission inventory, add the new row.`

The `/release-notes` call on the same step is correct and should stay.

---

## Informational Observations (not actionable)

### Observation A — Specialist split is now the de facto path for large features; full-stack-developer was used zero times in the 7 Ledger work-logs

The 2026-05-27 review found "full-stack-developer owns 9/10 Phase 4 cases" and called the specialist split "a paper fiction." Thirty days later the data has inverted: the dues tracking feature and all 6 Ledger increments ran db-admin → api-developer → ux-developer cleanly. Full-stack-developer was not used once for feature work. This is a positive signal — the specialist split works for large, well-designed features. The "full-stack as default" framing from prior retros needs a corresponding update (see Finding 3a).

### Observation B — qa is catching real functional defects (500-vs-409, donorId no-op, get990Prep balance, missing sync tests) every cycle; the pipeline is earning its keep

The qa agent caught at least one real defect per Ledger increment:
- inc3 (compliance): `POST /api/admin/ledger/filings` returned 500 instead of 409 on unique constraint — FAIL returned to implementer.
- inc4 (reports): `determine990` had zero unit tests despite Phase 3 requiring them — wrote 11 tests.
- inc6a (donors): `dues-ledger-sync.ts` had 14 missing unit tests despite Phase 3 naming them explicitly — wrote all 14.

The FAIL-and-loop-back on inc3 was a real catch (500 vs 409 is user-visible). The missing-test pattern in inc1 and inc6a is the implementer gap captured in Finding 1.

---

## Checked and Clean

| Bucket | Verdict |
|--------|---------|
| `analyst.md` | Accurate. Five-pass structure, surface taxonomy, Phase 1/Phase 6 bodies — consistent with CLAUDE.md. |
| `architect.md` | Accurate except for the `xlsx` → `exceljs` replacement (Finding 2). Directory structure rules match actual `src/` layout. |
| `tech-lead.md` | Accurate. Design doc template, code review checklist, ownership section all match current practice. |
| `database-admin.md` | Accurate. Schema patterns, migration patterns match conventions. Migration number collision guidance is missing (Finding 4). |
| `api-developer.md` | Accurate. Route handler pattern, error codes, `sendEmail()` — all match codebase. Missing Phase-3-test-deliverable checklist item (Finding 1). |
| `ux-developer.md` | Accurate. Component patterns, brand color rules, ConfirmDialog usage — consistent with CLAUDE.md UX Guidelines. |
| `full-stack-developer.md` | Accurate. Correctly cross-references api-developer and ux-developer. Missing Phase-3-test-deliverable note (Finding 1). |
| `deployment-engineer.md` | Accurate. External-system failures section (Vercel duplicate-account) correctly added per retro-2026-06-24 MUST. |
| `qa.md` | Accurate. Feature-gate audit section and coverage targets are correct. qa correctly writes regression tests; the missing-implementer-tests pattern is an api-developer/full-stack issue. |
| `neon-postgres` skill | Accurate. Pooling guidance, branching workflow, Drizzle Kit command names all match the project. |
| `new-feature` skill | Accurate. Pipeline table matches CLAUDE.md. |
| `release-notes` skill | Accurate. Template structure, "no file lists" invariant match actual release notes. |
| `pre-push` skill | Accurate. Step 8 (CVE audit) correctly added per retro-2026-05-27 MUST. All 11 steps match build commands. |
| `add-permission` skill | Mostly accurate. Stale Step 6 sentence remains (Finding 5). |
| Agent Roster table in CLAUDE.md | Accurate except for deployment-engineer "Pre-deploy" framing (Finding 3b carry-forward). |
| Pipeline phases in CLAUDE.md vs. agent files | Consistent. Phase numbers, owner names, gate descriptions, loop-back rules all agree. |

---

## Proposed Edits Summary

| # | File | Severity | Change | Cycles pending |
|---|------|----------|--------|----------------|
| 1a | `api-developer.md` | MUST | Add Phase-3-test-deliverable checklist item | new |
| 1b | `full-stack-developer.md` | MUST | Add Phase-3-test-deliverable note | new |
| 2 | `architect.md` | MUST | Replace `xlsx` with `exceljs` in "Already available" list | new |
| 3a | `CLAUDE.md` → Phase 4 table | SHOULD | Note on specialist split vs. full-stack for large vs. small features | 2 cycles |
| 3b | `CLAUDE.md` → Agent Roster | SHOULD | Deployment-engineer is reactive, not a mandatory phase | 2 cycles |
| 3c | `CLAUDE.md` → Bug-Fix Variant | COULD | Require minimal work-log stub | 2 cycles |
| 4a | `database-admin.md` | LOW | Migration number: always re-check at Phase 4 start, don't trust Phase 2/3 proposal |  new |
| 4b | `architect.md` | LOW | Migration number is tentative in Phase 2 proposals | new |
| 5 | `add-permission` SKILL.md | LOW | Remove stale "if CLAUDE.md maintains inventory" sentence | 2 cycles |

---

## Baseline for Next Review

**Date of this review:** 2026-06-27  
**Next agent-instruction review due:** 2026-07-27  

**Items to watch:**
- Were the two new MUSTs (1a api-developer, 1b full-stack-developer test-deliverable note; 2 architect xlsx→exceljs) applied?
- Were the three 2-cycle SHOULD carry-forwards (3a, 3b, 3c) applied?
- Did the qa unit-test gap recur in any new increment?
- Were the failing e2e specs (cancel-occurrence, write-in-signups) annotated or fixed? (tracked separately from the retrospective)

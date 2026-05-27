# Retrospective — 2026-05-27

**One-line outcome:** First retrospective; two cross-review PII/CVE clusters confirm that security hygiene escapes the Phase 4 gate; pipeline is structurally sound but the Phase 4 specialist split is unused and the pre-deploy role is misrepresented — 5 proposed edits, 1 must-fix, 3 should-fix, 1 could-fix.

---

## 1. Patterns Across the Reviews

### The PII cluster

Both the code review (MEDIUM-3) and the security review (FINDING-4) independently identified the same two endpoints — `GET /api/admin/members/export` and `GET /api/admin/newsletter/export` — as returning bulk PII to any authenticated user with no feature gate. Two separate reviews written by different agents (architect lens vs. api-developer lens) converging on identical files and lines is not noise.

What it means: the feature-gate check is a well-documented project invariant (`auth()` + `hasFeature()` on every protected route, stated explicitly in CLAUDE.md Key Invariants and in the Phase 4 gate criteria), yet both endpoints shipped without it. The feature was implemented, reviewed by QA, and shipped as SHIP IT without the gate. This means the omission was not caught by any Phase 4 or Phase 5 step.

The most likely failure mode is that the export endpoints were written before the feature-gate pattern was fully settled, and no subsequent review swept for missing gates. The code-review and security-review periodic reviews caught it now, but the pipeline did not catch it when the code was written.

### The CVE cluster

Both the security review (FINDING-1, FINDING-2) and the dependencies review independently flagged `next` 16.1.6 and `drizzle-orm` 0.45.1 as having high-severity CVEs with available patches. Neither review disagreed on the fix: bump `next` to 16.2.6 and `drizzle-orm` to 0.45.2.

What it means: dependency hygiene requires no design judgment — it is a mechanical `pnpm outdated` + `pnpm audit --prod` check. The dependencies review exists precisely to run this scan monthly. The fact that it caught the same items as the security review confirms the two reviews are doing their jobs. But neither finding was present in any work-log entry and neither was caught before the reviews were run. There is no pre-push gate that requires a `pnpm audit --prod` scan before merging to main. Security CVEs in direct production dependencies can accumulate between monthly sweeps without any forcing function.

### What the convergence says about slip patterns

The pipeline is catching correctness issues (the QA loop-backs on write-in signups, add-to-calendar dropdown, and recurring rollup all fired correctly). What slips through is security-hygiene issues that look like they are working: the export endpoints return data correctly, QA confirmed the happy path, and the analyst signed off. Neither the QA phase nor the analyst phase in the current pipeline description explicitly mandates checking feature gates on every touched route. The gate review is an implicit expectation of Phase 4, not a checklist item in Phase 5.

---

## 2. Pipeline Efficacy

### All six phases are running

Every work-log entry from the past 10 features shows all six phases present and attributed. Loop-backs fired correctly in four of the ten features (write-in signups had three QA loop-backs; add-to-calendar dropdown had one; recurring rollup had one; cancel-occurrence had one). The loop-back mechanism is working.

Phase 2 was explicitly skipped (with notation) in two bug-fix variants. Phase 2 silently missing from `event-times-wall-clock` is a gap — the phase is absent from the work-log header table, though the work-log does describe the fix shape. That is the only silent skip observed.

### The specialist split has never fired

Across all 10 work-log entries: full-stack-developer owned Phase 4 nine times, ux-developer owned it once (add-to-calendar dropdown, correctly), and neither database-admin nor api-developer has ever appeared as a Phase 4 owner. The agent-instruction review noted this; the retrospective synthesis is that the pipeline description creates a false impression that specialist routing is the norm. It is not. The 150-line threshold in full-stack-developer.md maps well to reality — almost all features in this codebase are small and tightly coupled. The CLAUDE.md "Implementer selection" table should reflect that full-stack-developer is the default path, not one of four equally likely options.

More consequentially: the deployment-engineer agent is described in CLAUDE.md as owning a "Pre-deploy" pipeline phase, but no work-log entry contains a "Pre-deploy" section. The `/pre-push` skill absorbs that role. A new contributor reading CLAUDE.md would expect a deployment-engineer invocation step that never happens. This mismatch is low-risk today (the `/pre-push` skill is comprehensive) but becomes a real gap if someone ever writes a work-log and believes they can skip `/pre-push` because no deployment-engineer phase entry is required.

### What is working

- The analyst (Phase 1 and Phase 6) is functioning as the only hard gate. Every feature has a Phase 6 SHIP IT. Two Phase 5 failures escalated correctly (write-in signups returned to Phase 4 with clear reproduction steps; add-to-calendar returned with a specific CSS failure).
- The QA agent correctly reproduces failures before confirming fixes. The loop-back protocol has real teeth.
- The work-log template is being filled out consistently; handoff notes name the next agent. Phase transitions are traceable.

---

## 3. What Is Working

The 115-unit-test suite, clean build, and absence of critical CVEs are not accidents.

- **Migrations idempotency discipline** — 39 migration files, all idempotent, all reviewed clean. Every developer who touched the schema followed the `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` pattern without exception. This is hard to maintain and the codebase has done it perfectly.
- **Auth boundary discipline** — no client components import `@/lib/db` or call `auth()` directly. The server/client split is clean across the entire codebase. This is a foundational invariant that is easy to violate once and hard to clean up, and it has held.
- **No native dialogs** — zero instances of `window.confirm`, `window.alert`, or `window.prompt` anywhere. The `<ConfirmDialog>` pattern was adopted uniformly. This kind of UI consistency is often the first thing that drifts.
- **Turnstile validation** — all four public form endpoints validate Turnstile server-side. This is the kind of defense that is easy to implement only on one endpoint and forget on the others.
- **Permission-cache invalidation** — every role grant/revoke and user mutation correctly calls `clearUserPermissionCache()`. This requires discipline at every mutation callsite and has been maintained without gaps.

These patterns share a common trait: they were defined as invariants, are testable (either by the build, the typecheck, or the code review checklist), and have explicit homes in CLAUDE.md. The issues that slipped through — missing feature gates, stale deps — are not testable by the build and have no mandatory check in the Phase 5 criteria.

---

## 4. Concrete Edits

### Edit 1 — Add a feature-gate audit to the Phase 5 QA checklist (MUST)

**File:** `.claude/agents/qa.md`

**What to add:** In the Phase 5 verification checklist, after the typecheck and build steps, add an explicit step: "For every new or modified route handler or server action touched in this feature, confirm that `auth()` is called before any DB access and that `hasFeature()` is called for any route under `/api/admin/` or `/(dashboard)/admin/`." This makes the gate check a Phase 5 requirement, not just a Phase 4 implicit expectation.

**Why:** The export endpoints passed QA without a feature gate. The build does not check for missing `hasFeature()` calls. Only a human step catches it. That step must be explicit in the QA checklist.

---

### Edit 2 — Add a `pnpm audit --prod` requirement to the pre-push skill (MUST)

**File:** `.claude/skills/pre-push/SKILL.md`

**What to add:** Add a step (after the typecheck / build steps, before the schema check) that runs `pnpm audit --prod --audit-level=high` and requires zero high-severity findings in production dependencies before the push is cleared. If any high-severity finding exists, the skill must surface the package, CVE, and fix path rather than just reporting readiness.

**Why:** The `next` and `drizzle-orm` high CVEs have been present for multiple releases. The pre-push skill runs before every push to main and is the natural forcing function for catching these before they accumulate. Monthly dependency reviews are too infrequent to catch a CVE that ships in a patch release.

---

### Edit 3 — Correct the Phase 4 implementer selection table in CLAUDE.md (SHOULD)

**File:** `CLAUDE.md` → Development Pipeline → Phase 4 — Implementation → Implementer selection table

**What to change:** Revise the table to reflect actual usage. Add a note that `full-stack-developer` is the default for any feature that doesn't clearly separate into schema-only or large server+client independent work. The current table presents four options as equally weighted; in practice `full-stack-developer` handles 90% of features. The note should read: "When in doubt, use `full-stack-developer` — the specialist split is reserved for work where the schema or the route layer is large enough to implement independently."

**Why:** Nine of ten Phase 4 entries were full-stack-developer. The current framing misleads new contributors and agents into routing work through specialists that will never be invoked.

---

### Edit 4 — Clarify the deployment-engineer role in CLAUDE.md (SHOULD)

**File:** `CLAUDE.md` → Agent Roster table, and Development Pipeline description

**What to change:** Remove "Pre-deploy" from the deployment-engineer row in the Agent Roster table and replace the description with "Reactive: build failures, env-var changes, Vercel diagnostics. Not a mandatory pipeline phase — `/pre-push` covers the pre-deploy checklist." In the Pipeline diagram description, replace the deployment-engineer step with a note that `/pre-push` is run before any push to main.

**Why:** No work-log has ever contained a "Pre-deploy (deployment-engineer)" phase. The agent is real and useful but its role is reactive. The current description implies a mandatory gate that does not exist in practice, which creates confusion about what is required before a push.

---

### Edit 5 — Merge the 30-day documentation and agent-instruction reviews (COULD)

**File:** `CLAUDE.md` → Periodic Reviews table; `tech-lead.md` → Ownership section

**What to change:** Combine the "Documentation" (30d, tech-lead) and "Agent & instruction" (30d, tech-lead) rows into a single "Instruction layer" (30d, tech-lead) review covering both CLAUDE.md drift and agent/skill files. Update the Ownership section in `tech-lead.md` accordingly.

**Why:** The agent-instruction review (Finding 4 in that review) noted the two reviews overlap substantially — both audit agent files and CLAUDE.md. Running them as separate passes on the same day produces duplicate findings (this retrospective itself covers items from both). Merging reduces review overhead without losing coverage.

---

## Proposed Edits Summary

| # | File | Severity | Change |
|---|------|----------|--------|
| 1 | `.claude/agents/qa.md` | MUST | Add explicit feature-gate audit step to Phase 5 checklist |
| 2 | `.claude/skills/pre-push/SKILL.md` | MUST | Add `pnpm audit --prod --audit-level=high` as a pre-push gate |
| 3 | `CLAUDE.md` → Phase 4 table | SHOULD | Note full-stack-developer as the default; specialist split is the exception |
| 4 | `CLAUDE.md` → Agent Roster + Pipeline | SHOULD | Deployment-engineer is reactive; `/pre-push` fills the pre-deploy slot |
| 5 | `CLAUDE.md` + `tech-lead.md` | COULD | Merge documentation and agent-instruction reviews into one |

---

## Baseline for Next Retrospective

**Date of this retrospective:** 2026-05-27  
**Next retrospective due:** 2026-06-03  

**Items to watch:**
- Were the two MUST edits (qa.md + pre-push) applied?
- Were `next`, `drizzle-orm` CVE bumps shipped?
- Did any feature go through the specialist (database-admin / api-developer) Phase 4 path?
- Was the `event-edit-orphans-rsvps` pipeline (currently stalled at Phase 1 pending) advanced?

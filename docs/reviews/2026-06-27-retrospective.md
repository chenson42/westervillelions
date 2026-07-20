# Retrospective — 2026-06-27

**One-line outcome:** 35-day window shipped 8 features through the full pipeline cleanly; specialist split proved real and efficient for large multi-layer features; qa unit-test gap recurred twice (now captured in agent-instruction review); three SHOULD carry-forwards remain unapplied at 2+ cycles; scope-mid-flight additions are a recurring pattern worth formalizing; the pipeline earned its keep on a large, complex accounting system.

---

## Scope of This Retrospective

**Period covered:** 2026-05-23 – 2026-06-27 (35 days — cadence is 7 days; this is 5x overdue).  
**Features shipped:** Annual dues tracking (v1.19), Ledger inc1 Books (v1.20), Ledger inc2 Controls + Reimbursements (v1.21), Ledger inc3 Compliance/990 (v1.22), Ledger inc4 Reports (v1.23), Ledger inc5 Impact Dashboard (v1.24), Ledger inc6 Donors/Acks/Dues-auto-post (v1.25), receipt-storage pluggable abstraction (DECISION-020), donor-typeahead polish (v1.25.1).  
**Prior retro:** 2026-06-24 (which itself covered 2026-05-27 to 2026-06-24).

Because this immediately follows the 2026-06-24 retrospective (which covered the Vercel force-push incident), this retrospective focuses on the new material: the dues + ledger pipeline runs, spanning the full 35-day window.

---

## 1. Prior Retro Status — Did the 7 Proposed Edits Land?

### Carry-forward from 2026-05-27

| Edit | Severity | Status |
|---|---|---|
| qa: feature-gate audit step | MUST | APPLIED (commit 00339f3) |
| pre-push: CVE audit step | MUST | APPLIED (commit 00339f3) |
| CLAUDE.md: full-stack-developer as default | SHOULD | **NOT APPLIED** (now at 3 cycles) |
| CLAUDE.md: deployment-engineer is reactive | SHOULD | **NOT APPLIED** (now at 3 cycles) |
| Merge doc + agent-instruction reviews | COULD | Not applied |

### Carry-forward from 2026-06-24

| Edit | Severity | Status |
|---|---|---|
| CLAUDE.md Workflow Rules: no force-push to diagnose external failures | MUST | APPLIED |
| deployment-engineer.md: ground truth before acting; known Vercel failure modes | MUST | APPLIED |
| CLAUDE.md Gotchas: Vercel duplicate-account failure mode | SHOULD | APPLIED |
| CLAUDE.md Phase 4: full-stack as default (carry-forward) | SHOULD | **NOT APPLIED** (now at 3 cycles) |
| CLAUDE.md Agent Roster: deployment-engineer reactive (carry-forward) | SHOULD | **NOT APPLIED** (now at 3 cycles) |
| e2e: annotate or fix failing cancel-occurrence / write-in-signups tests | SHOULD | Not assessed this window |
| CLAUDE.md Bug-Fix Variant: require minimal work-log stub | COULD | Not applied |

**Summary of applied MUSTs from prior retros:** All 4 MUSTs are applied and held.  
Three SHOULD carry-forwards are now at 3 cycles. The "full-stack as default" framing from the 2026-05-27 retro has since been corrected by observation — see Section 2 — so the proposed edit text needs updating, not just application.

---

## 2. Pipeline Efficacy — What the 35-Day Window Reveals

### 2.1 Specialist split is now the confirmed path for large features

The prior retros (2026-05-27 and 2026-06-24) called the specialist split a "paper fiction" because full-stack-developer had handled 9 of 10 Phase 4 assignments. The Ledger period inverts this completely:

- **Dues tracking:** database-admin → api-developer → ux-developer (3 specialists)
- **Ledger inc1–inc6:** database-admin → api-developer → ux-developer on every increment

Full-stack-developer was not used once for any of the 7 new features. The specialist split is real, working, and the correct path for features of this complexity. The CLAUDE.md carry-forward edit (Finding 3a in the agent-instruction review) now needs a corrected framing: the prior proposed text said "full-stack is default; specialist is the exception." That was accurate when features were small. It is now accurate to say: **full-stack for small features (~< 150 lines), specialist path for large features with distinct schema + API + UI layers.** The edit must reflect this revised framing.

### 2.2 Phase 3 → Phase 4 handoffs were clean and detailed

Every ledger work-log has a Phase 3 design doc that includes: exact schema with column names and types, API contract with request/response shapes, explicit gate table, component/page list, and implementation order with the specific implementer named per step. The database-admin, api-developer, and ux-developer phases all consumed this without requesting clarification in any increment except one (compliance inc3, which had a migration number collision — addressed separately). Phase 3 quality improved substantially compared to the early pipeline runs (May).

### 2.3 qa is catching real defects every cycle — the loop-back mechanism works

Loop-backs in this window:

- **Dues tracking Phase 3:** User-added scope expansion (treasurer role, family category, active-FY setting) forced a Phase 3 revision. The design doc was updated before any implementation began. This is the correct behavior — loop-back to Phase 3 rather than silently absorbing scope in Phase 4.
- **Ledger inc1 (Books):** qa found `determine990()` had zero unit coverage despite Phase 3 requiring tests. Wrote 11 tests. PASS.
- **Ledger inc2 (Controls):** Phase 6 issued SHIP WITH NOTES with two tracked FU items (UUID fragment in Approvals, `BLOB_READ_WRITE_TOKEN` absent from .env.example). Both resolved before next ship cycle. PASS on re-verify.
- **Ledger inc3 (Compliance):** qa issued FAIL — `POST /api/admin/ledger/filings` returned HTTP 500 instead of 409 on unique-constraint conflict. Loop-back to Phase 4b. Fix applied; re-verified to PASS. This is the most important QA catch of the cycle — a user-visible 500 that would have surfaced immediately in production.
- **Ledger inc6 (Donors):** qa found 14 missing unit tests for `dues-ledger-sync.ts` despite Phase 3 naming them explicitly. Wrote all 14. PASS.

The loop-back on inc3 (500 vs 409) is a correctness catch, not a missing-test catch. The loop-backs on inc1 and inc6 are the implementer unit-test gap pattern documented in the agent-instruction review. The two patterns are distinct:

- **Correctness gap (inc3):** qa caught a real functional defect. This is qa doing its job.
- **Missing-test gap (inc1, inc6):** qa wrote tests that the implementer was supposed to write per the Phase 3 spec. This is a Phase 4 gate failure, not a qa success story. The agent-instruction review's Finding 1 captures this and proposes the fix.

### 2.4 Scope mid-flight additions are a recurring pattern with no formal process

Three of the seven features had user-added scope mid-pipeline:

- **Dues tracking:** Three scope expansions — one after Phase 3 (forced Phase 3 revision), one during Phase 4, one post-ship. The Phase 3 revision was correctly handled. The during-Phase-4 and post-ship additions were absorbed without looping back to Phase 1 or Phase 3.
- **Ledger inc2 (Controls):** Reimbursements added mid-Phase-1. The analyst documented the addendum correctly and Phase 2 / Phase 3 absorbed it cleanly.
- **Ledger inc6 (Donors):** The donors increment had a donorId link-fix added during Phase 4b that was a bug correction rather than scope addition — handled inline correctly.

The mid-Phase-1 reimbursement addition was handled well. The mid-Phase-4 and post-ship dues additions were not looped back through Phase 3 — they were implemented directly. For small scope additions this is pragmatic; for additions that change the data model or API surface, skipping Phase 3 creates risk that the design isn't thought through. There is no explicit rule in CLAUDE.md or any agent file about how mid-flight scope additions should be routed. This is a process gap.

### 2.5 All 7 features reached SHIP IT or SHIP WITH NOTES (all with follow-ups resolved)

| Feature | Phase 6 verdict | Notes |
|---|---|---|
| Dues tracking | SHIP WITH NOTES | Three minor notes; two fixed immediately |
| Ledger inc1 (Books) | SHIP IT | One minor drift item (form990Line on categories — no UI yet) |
| Ledger inc2 (Controls) | SHIP WITH NOTES | FU-5 (UUID in Approvals), FU-6 (BLOB_READ_WRITE_TOKEN); both resolved |
| Ledger inc3 (Compliance) | SHIP WITH NOTES | Entity garbage-slug fallback vs. notFound(); color badge mismatch; settings redirect |
| Ledger inc4 (Reports) | SHIP IT | Clean |
| Ledger inc5 (Impact) | SHIP IT | Clean |
| Ledger inc6 (Donors) | SHIP IT | Two tracked follow-ups, neither blocking |

No increment was returned to Phase 1 or Phase 2 from Phase 5 or Phase 6. One was returned from Phase 5 to Phase 4b (compliance 500 → 409). This is a clean record for a six-increment system with 9 DB tables and ~25 API routes.

---

## 3. Patterns That Emerged Over the 35-Day Window

### 3.1 The "migration number collision" risk materialized once

The ledger-reports Phase 2 architect proposed migration `0048_ledger_990_lines.sql`. By Phase 4, `0048_ledger_compliance.sql` had already been claimed by a concurrent increment. The database-admin self-corrected by checking the actual `drizzle/migrations/` directory and using `0049`. No harm done, but the risk is real when multiple increments are in flight. The agent-instruction review captured this as Finding 4. The proposed fix (database-admin checks actual next number at Phase 4 start; architect labels Phase 2 migration numbers as tentative) is the right resolution.

### 3.2 The receipt-storage abstraction (DECISION-020) shows Phase 2 done right

The original inc2 Phase 2 decision was Vercel Blob (DECISION-018). A follow-up session recognized that Vercel Blob is unavailable locally without a token, which broke zero-config local dev. The architect revised to a pluggable interface (DECISION-020): `VercelBlobStorage` when `BLOB_READ_WRITE_TOKEN` is set, `LocalReceiptStorage` otherwise. This is the correct pattern — the abstraction was introduced before any client code was locked in. The Phase 2 loop-back that produced DECISION-020 was not formally in the work-log (it appears as a between-increments correction) but the outcome is the right one. This represents Phase 2 value: catching a deployment-environment mismatch before implementation.

### 3.3 Work-log entries for bug fixes remain absent

The agent-instruction review noted this; the 2026-06-24 retro proposed requiring a minimal work-log stub for even trivial fixes. Between the two retros, no bug fixes were shipped — the entire window was feature work. The `event-edit-orphans-rsvps` feature has been stalled at Phase 1 (Pending) since 2026-05-22 and has not advanced. This is not a regression; no new stalls were added. But the unapplied carry-forward remains: when the next bug fix lands, there will still be no guidance requiring a stub.

### 3.4 SHIP WITH NOTES follow-ups were resolved promptly but not always tracked

Inc2 follow-ups (FU-5 UUID display, FU-6 BLOB token) were documented and resolved in the same session. Inc3 follow-ups (entity garbage-slug, badge color mismatch) were acknowledged as cosmetic and not immediately resolved — the work-log does not record whether they were subsequently fixed. There is no formal mechanism to track SHIP WITH NOTES follow-ups across sessions. This is a low-risk gap (the work-log documents them) but could calcify if the project velocity increases.

### 3.5 The analyst-driven Phase 1 is doing real work

Every dues/ledger Phase 1 produced a five-pass review with explicit gap lists. In the dues tracking feature, the analyst's gap list (10 items) was the input that produced the scope expansion conversation with the user — which resolved design questions that would have been expensive to revisit in Phase 4. In the ledger inc1, the analyst's transfer-representation gap question was the trigger for DECISION-016. Phase 1 is not rubber-stamping; it is actively preventing Phase 4 rework.

---

## 4. What Is Working Well

- **Migrations idempotency discipline:** 6 new migrations over the ledger + dues window; all idempotent; all using IF NOT EXISTS / WHERE NOT EXISTS / ON CONFLICT guards. The database-admin never shipped a non-idempotent statement. This is the hardest discipline to maintain and it held across 6 increments.
- **Permission gate discipline:** The agent-instruction review confirmed all new ledger and dues routes have auth() + hasFeature() on every handler. The qa feature-gate audit table (added 2026-05-27) is working — qa is auditing every route systematically.
- **Cents everywhere:** The entire ledger system uses integer cents without exception. No decimal arithmetic crept in.
- **Phase 3 design docs are load-bearing:** The ledger inc1 design doc alone prevented at least three implementation mistakes (transfer-from-fund column vs. two-row design, fiscal-year as stored column vs. derived at query time, native browser dialogs for delete).
- **No `lions-red`, no `window.confirm`, no native dialogs:** Confirmed clean across all 9 new admin pages.
- **The 293-test suite is real:** Every increment added unit tests and the suite grew from 115 (start of window) to 293. The coverage is not synthetic — the inc3 qa catch (500 vs 409) and the inc6 sync-test gap show the suite is catching real issues.

---

## 5. What Is Not Working

### 5.1 Three SHOULD carry-forwards are at 3 cycles without application

The CLAUDE.md Phase 4 implementer-selection note and the deployment-engineer reactive-role note have been proposed in three consecutive retrospectives. They remain unapplied. At 3 cycles, these are now MUST-level urgency — not because the content has become more urgent, but because unapplied carry-forwards signal that the retro output is not being acted on. A retro that produces only carry-forwards is not improving the process.

Additionally, the framing of the "full-stack as default" edit needs to be updated before application — the new evidence (specialist split worked cleanly for 7 features) means the proposed text from the 2026-05-27 retro is now stale. The correct framing is: **specialist path for large features; full-stack for small ones.** The edit should reflect this, not repeat the old text.

### 5.2 No formal process for mid-flight scope additions

Three of seven features absorbed user-added scope during or after Phase 3 without a formal routing decision. For addendum scope within Phase 1 (reimbursements in inc2) the pipeline handled it correctly. For post-Phase-3 additions (dues tracking scope expansion 2 and 3), the pipeline absorbed scope directly into Phase 4 and post-ship without explicit Phase 3 re-entry. This is pragmatic but means the tech-lead's design doc does not cover the added scope.

### 5.3 Implementer unit-test gap recurred in inc1 and inc6

Captured in the agent-instruction review (Finding 1, MUST). The retrospective notes this is a recurring pattern that survived two pipeline cycles without the root fix (adding a test-deliverable checklist to api-developer.md and full-stack-developer.md). The agent-instruction review proposes the fix; this retrospective endorses it as the right resolution.

---

## 6. Concrete Proposed Edits

### Edit 1 — Update the Phase 4 implementer-selection guidance in CLAUDE.md (MUST — escalated from SHOULD at 3 cycles)

**File:** `CLAUDE.md` → Development Pipeline → Phase 4 → Implementer selection table

**What to add** (replacing the prior proposed text from 2026-05-27, which is now stale):

After the Implementer selection table, insert:

> **Specialist split vs. full-stack:** For a large feature with new schema + API + UI, run the specialist split (database-admin → api-developer → ux-developer) — every increment of The Ledger ran this way cleanly. Reserve **full-stack-developer** for work that is small and tightly coupled (~< 150 lines across API + UI) where a handoff would add more overhead than it removes.

**Why:** Three cycles carried forward; the evidence from The Ledger window has now settled the question. The current framing (four options, equally weighted) is actively misleading. This exact text is already in the agent-instruction review's Finding 3a — apply it to CLAUDE.md now.

**Cycles pending:** 3 (original 2026-05-27 SHOULD, now escalated)

---

### Edit 2 — Update Agent Roster: deployment-engineer is reactive (MUST — escalated from SHOULD at 3 cycles)

**File:** `CLAUDE.md` → Agent Roster table

**What to change:** Replace the deployment-engineer row:

> `| **deployment-engineer** | Reactive | Build failures, env-var changes, Vercel diagnostics — invoked on demand, not as a mandatory pipeline phase. `/pre-push` covers the pre-deploy checklist. |`

**Why:** Three cycles carried forward; this is now the most-stale unapplied edit in the retro history.

**Cycles pending:** 3 (original 2026-05-27 SHOULD, now escalated)

---

### Edit 3 — Add a mid-flight scope routing rule to CLAUDE.md (MUST — new)

**File:** `CLAUDE.md` → Development Pipeline → Phase 4 section (or a new "Scope Changes Mid-Pipeline" subsection)

**What to add:**

> **Mid-flight scope additions:** If a user adds scope after Phase 3 is complete, route it based on size:
>
> - **Purely additive, no schema change, no new API surface, < 30 lines:** absorb inline in Phase 4; note the addition in the work-log.
> - **New schema column, new API endpoint, or new UI page:** loop back to Phase 3 (tech-lead) to amend the design doc before Phase 4 implementation begins. Phase 4 must not implement undesigned schema or API.
> - **Fundamentally different scope (new user-facing flow, new permission):** loop back to Phase 1 (analyst) for a fresh five-pass review before Phase 3.

**Why:** Three of seven features in this window absorbed mid-flight scope without formal routing. The dues tracking "active fiscal year" addition (post-Phase-3) required a new schema column (`is_active` on `dues_settings`), a partial unique index, and a new API read path — that should have looped back to Phase 3 but was absorbed into Phase 4 directly. The analyst's five-pass review catches security implications; the tech-lead's design doc catches data-shape mistakes. Bypassing both for non-trivial scope creates risk.

---

### Edit 4 — Add minimal work-log stub requirement to Bug-Fix Variant in CLAUDE.md (SHOULD — carry-forward, now at 2 cycles)

**File:** `CLAUDE.md` → Development Pipeline → Bug-Fix Variant

**What to add:**

> Even for trivial fixes, create a minimal work-log stub at `docs/work-log/YYYY-MM-DD-<slug>.md` recording: root cause (one sentence), fix shape (one sentence), which phases were explicitly skipped and why. A 5-line stub enables the next retrospective without requiring a commit-diff archaeology session.

**Why:** Carry-forward from 2026-06-24 retro. The window had no bug fixes so it was not exercised — but the next bug fix will land without guidance unless this is applied.

**Cycles pending:** 2

---

### Edit 5 — Add SHIP WITH NOTES follow-up tracking to the work-log template (SHOULD — new)

**File:** `docs/work-log/_template.md`

**What to add:** In the Phase 6 section template, add a "Follow-up tracking" subsection:

> ### Follow-up items
> | # | Item | Severity | Responsible | Target |
> |---|------|----------|-------------|--------|
>
> Follow-ups must be resolved before the next retrospective, or explicitly deferred with a tracking note. "SHIP WITH NOTES" items that are cosmetic (display strings, badge colors) may be deferred. Items that are functional or security-relevant must be resolved before the next release cycle.

**Why:** Inc2 FU-5 and FU-6 were resolved promptly. Inc3's entity garbage-slug fallback and badge color mismatch were acknowledged but not tracked for resolution — the work-log does not record whether they were fixed. A standard follow-up table in the template makes the status visible.

---

### Edit 6 — Apply the agent-instruction review's MUST edits (MUST — deferring to that review's tracking)

The agent-instruction review (2026-06-27) identified three new MUSTs:

- 1a: `api-developer.md` — Phase-3-test-deliverable checklist item
- 1b: `full-stack-developer.md` — Phase-3-test-deliverable note
- 2: `architect.md` — Replace `xlsx` with `exceljs` in "Already available" list

These are tracked in the agent-instruction review. The retrospective records them here as confirmed-real process gaps seen in the window (inc1 and inc6 both had the test-deliverable miss) and endorses applying them at the same time as Edits 1–5 above.

---

### Edit 7 — Add specialist-split observation to CLAUDE.md Phase 4 (informational note, LOW)

**File:** `CLAUDE.md` → Development Pipeline → Phase 4 (same location as Edit 1)

**What to add** (in addition to Edit 1's text):

> **Specialist split vs. full-stack in practice:** The specialist split has now run on 7 consecutive large features (dues tracking + 6 Ledger increments) without handoff failures. The full-stack-developer path remains the right choice for small features; do not route large features through it to avoid the handoff ceremony — the ceremony is where design gaps surface.

**Why:** The prior retros expressed uncertainty about whether the specialist split "worked in practice." It does. This observation should be codified so future sessions don't reopen the question.

---

## 7. Proposed Edits Summary

| # | File | Severity | Change | Cycles pending |
|---|------|----------|--------|----------------|
| 1 | `CLAUDE.md` → Phase 4 | MUST | Specialist split vs. full-stack guidance (revised framing from prior SHOULDs) | 3 cycles, escalated |
| 2 | `CLAUDE.md` → Agent Roster | MUST | Deployment-engineer is reactive, not mandatory phase | 3 cycles, escalated |
| 3 | `CLAUDE.md` → Phase 4 | MUST | Mid-flight scope routing rule | new |
| 4 | `CLAUDE.md` → Bug-Fix Variant | SHOULD | Require minimal work-log stub for trivial fixes | 2 cycles |
| 5 | `docs/work-log/_template.md` | SHOULD | SHIP WITH NOTES follow-up tracking table in Phase 6 template | new |
| 6 | `api-developer.md`, `full-stack-developer.md`, `architect.md` | MUST | Agent-instruction review MUSTs (test-deliverable; xlsx→exceljs) | new (endorsed here) |
| 7 | `CLAUDE.md` → Phase 4 | LOW | Add specialist-split-in-practice observation | new |

---

## 8. Items to Watch at Next Retrospective

**Next retrospective due:** 2026-07-04 (7-day cadence)

- Were Edits 1, 2, 3 (the three MUSTs) applied?
- Was Edit 6 (agent-instruction review MUSTs) applied?
- Did `event-edit-orphans-rsvps` (stalled at Phase 1 since 2026-05-22) advance?
- Were the failing e2e specs (cancel-occurrence, write-in-signups) annotated or scheduled?
- Did inc3's entity garbage-slug fallback and badge-color mismatch get resolved?
- Did any new feature enter the pipeline?
- Did any bug fix produce a work-log stub (validating Edit 4 if applied)?

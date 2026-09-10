# Retrospective — 2026-09-10

**One-line outcome:** 75-day gap (10x the 7-day cadence) during which the project shipped ~51 minor versions (v1.25→v1.76.2) essentially unsupervised by its own process; three separate gates (lint, e2e, review cadence) degraded silently in that window and each one's silent-failure mode is structurally the same — a crash or a mostly-green summary reads as "fine" unless a human reads past the headline; a live CRITICAL RCE pair and a real production CSP regression both hid inside that gap and were only caught when a push finally forced the CVE audit and a coordinator finally forced a test-coverage sweep. The rule written after the *last* retrospective specifically to prevent untracked bug fixes (work-log stub, MUST, applied to CLAUDE.md) was itself violated twice in this same session, on the very type of change it was written for. The pipeline, when actually invoked, worked — today's minutes-browsing feature is a clean, real example of the specialist split catching a genuine defect. The open question is not whether the pipeline works; it's why four separate hygiene reviews (retrospective, documentation, code, agent-instruction) all went dark on the exact same day and stayed dark for ten weeks while security and CVE response did not.

---

## Scope of This Retrospective

**Period covered:** 2026-06-27 – 2026-09-10 (75 days — cadence is 7 days; this is ~10.7x overdue).
**Prior retro:** 2026-06-27 (itself already 5x overdue at the time it ran).
**Note on scope:** 75 days of feature work is too much to re-litigate feature-by-feature (103 work-log files postdate 2026-06-27). This retrospective follows the brief: it treats 2026-09-09/10 as the detailed case study (full pipeline run, lint-gate resurrection, CVE patch, e2e restoration) and treats the wider window structurally — what the review-cadence record itself shows about the 75 days in between.

---

## 1. Prior Retro Status — Did the 7 Proposed Edits Land?

| # | Edit | Severity (2026-06-27) | Status now |
|---|------|------------------------|-------------|
| 1 | CLAUDE.md Phase 4 — specialist split vs. full-stack guidance | MUST | **APPLIED** — present verbatim in current CLAUDE.md |
| 2 | CLAUDE.md Agent Roster — deployment-engineer is reactive | MUST | **APPLIED** |
| 3 | CLAUDE.md Phase 4 — mid-flight scope routing rule | MUST | **NOT APPLIED** — no trace of this text anywhere in CLAUDE.md. See §4.1 — this is now the most severe unactioned carry-forward in the project's retrospective history. |
| 4 | CLAUDE.md Bug-Fix Variant — minimal work-log stub requirement | SHOULD | **APPLIED to the text** — but violated in practice this very session. See §2.3. |
| 5 | work-log `_template.md` — SHIP WITH NOTES follow-up table | SHOULD | **APPLIED** (`## Follow-Ups (if SHIP WITH NOTES)` section exists) |
| 6 | Agent-instruction MUSTs (api-developer/full-stack test-deliverable checklist; architect xlsx→exceljs) | MUST | **APPLIED** — both agent files carry the checklist language; `architect.md`'s "already available" list now reads `exceljs`, no `xlsx` |
| 7 | Specialist-split-in-practice observation (LOW) | LOW | Effectively subsumed into Edit 1's text; not separately worth chasing |

**Read on this:** six of seven edits landed, including every MUST except Edit 3. That is a genuinely good compliance rate for a retrospective's own recommendations — the mechanism of "write it down, next review checks it" works when someone runs the next review. The failure here isn't that edits don't stick; it's that *no session ran the next review for 75 days*, so nothing checked whether they stuck, and one MUST (mid-flight scope routing) fell through entirely and has now gone unaddressed through an entire ten-week window of active feature work — several of that window's features (dues tracking scope creep was the original evidence for the rule) are exactly the shape this rule was written to catch.

The June 2026-06-27 agent-instruction review's own carry-forward table (a sibling document, same date) shows the same pattern: 1a/1b/2/4a/5 applied, 3a/3b/3c applied via the retrospective's own edits above, only 4b (architect.md: label Phase-2 migration numbers as tentative) never landed — LOW severity, still open, now at 2+ cycles.

---

## 2. Findings, Ranked by Severity

### 2.1 CRITICAL — The retrospective cadence itself failed for 75 days, and it was not the only hygiene review that did

**Evidence — `docs/reviews/log.md` most-recent dates as of 2026-09-10, before this entry:**

| Review | Cadence | Last run | Days overdue |
|---|---|---|---|
| retrospective | 7d | 2026-06-27 | **68 days overdue** (75 days since, cadence 7) |
| documentation | 30d | 2026-06-27 | **45 days overdue** |
| code | 30d | 2026-06-26 | **46 days overdue** |
| agent-instruction | 30d | 2026-06-27 | **45 days overdue** |
| dependencies | 30d | 2026-07-28 | **14 days overdue** |
| security | 30d | 2026-09-03 | current (ran twice, app+data halves) |
| test-coverage | 7d | 2026-09-09 (just run) | current |

Four of six reviews — retrospective, documentation, code, agent-instruction — share the **exact same last-run date**, 2026-06-27, and none of the four ran again until this session forced them. Security did not go dark: it ran again on 2026-09-03, split into two halves, with real findings (a high-severity PII gate gap, fixed in-review). Dependencies drifted less badly (44 days late on a 30-day cadence vs. 68 days late on a 7-day one).

**This is not "the reviews didn't run" as a flat fact — it's a specific, informative shape: security review kept running; process-hygiene review did not.** Security has a visceral trigger (PII, a public repo, a known prior incident) that keeps it top-of-mind even during a long feature-shipping streak. Retrospective/documentation/code/agent-instruction have no equivalent trigger — nothing forces attention back to them except someone choosing to run them, and during 75 days and ~51 shipped minor versions, nobody did. The 2026-06-27 retrospective itself predicted this exact failure mode in weaker form ("a retro that produces only carry-forwards is not improving the process") but had no mechanism to prevent it beyond "ask nicely at session start."

**Why "run the reviews on time" is not a useful recommendation (per the brief) and what is:** The existing mitigation — CLAUDE.md's "Cadence Check at Session Start," which asks the *next* session to read `docs/reviews/log.md` and surface overdue reviews — is exactly the mechanism that failed here. It depends on a session choosing to do the check before diving into feature work, and 75 days of feature-shipping sessions apparently didn't. Telling the process to try harder at the thing it already had an instruction to do is circular, as the brief notes.

What's different this time is that this environment now has a scheduling primitive (the `schedule` skill: cron-based cloud agents that run independent of any interactive session) that didn't require manual invocation at session-start. A cadence check that depends on a human-initiated session remembering to look is exactly the failure mode observed twice now (168 days across two retros, 45+ days on three siblings). **Proposed structural fix:** stand up a scheduled, read-only weekly job (via the `schedule` skill) whose only job is to diff `docs/reviews/log.md` against each review's cadence and post a status message — not to run the review itself (a review needs judgment and repo access this environment's `bypass permissions` posture over a cron job may not want), just to make "reviews are overdue" an event that arrives on its own rather than a fact that has to be independently rediscovered every session. This converts an honor-system check into an actual notification, at low cost, without asking a cron job to make judgment calls in a club's production codebase unsupervised. **This is a candidate to evaluate, not a decision to apply on this pass — it changes the project's automation posture and belongs to whoever owns that call** (flagging for the user / architect, not applying it here).

**Proposed CLAUDE.md edit (MUST):** Under Periodic Reviews → Cadence Check at Session Start, append:

> **This check has already failed once for 75 days.** If more than one review type shows up overdue by more than 2x its own cadence, do not silently offer "proceed or defer" — name the specific reviews, and note explicitly that this means the honor-system check itself is not being exercised, not just that reviews are behind. This is a distinct signal from an isolated single-review lapse.

---

### 2.2 HIGH — Three independent gates failed open, and they share a structural cause: a degraded gate produces output that reads as "normal" without close reading

The brief asks whether this is one structural problem or several. It is **one shape wearing three costumes**:

- **Lint gate:** didn't fail — it **crashed** (`minimatch: ^10` fed an ESM-only module into `@eslint/eslintrc`'s CJS-style default import, then a legacy `FlatCompat` path failed schema validation). A crash produces a stack trace, not a red/green verdict. `/pre-push` runs `pnpm lint` as one of its steps; a crashing subprocess is easy to read as "tooling is broken, not my problem" rather than "this blocks the push," especially under time pressure. 24 real errors and, later, 43 real warnings accumulated **unseen** for an unknown but clearly multi-week span (`cc7c5e4`'s message: *"pnpm lint had been crashing outright, so these accumulated unseen"*).
- **e2e suite:** didn't crash — it degraded to 131 passed / 13 failed / 41 did not run, and **stayed there**. A mostly-green summary with a stable-looking failure count reads as "the usual noise," especially once workers>1 made even that count nondeterministic (4 of the 13 vanished on a serial re-run). The 2026-09-09 test-coverage review's own words: *"a real production regression survived five days [...] because 13 failures were the normal state, so a new one was indistinguishable from rot."*
- **Review cadence:** didn't crash or degrade — it simply never got checked, because the check itself is a prose instruction inside a session's context, competing with whatever the session was actually asked to do.

**The common mechanism: none of these three had a hard, binary, impossible-to-miss failure mode.** Contrast with the one gate in this same window that *did* work as designed: the CVE audit (`pnpm audit --prod --audit-level=high`) has an exit code, and it caught two CRITICAL unauthenticated-RCE advisories the moment a push actually ran `/pre-push` (commit `0c6e65a`). That gate is structurally different from the other three: it cannot silently degrade to "mostly clean" — it is 0 or nonzero, checked by a script, not by a person reading a wall of text and forming a judgment.

**This suggests a real structural fix, not three separate ones:** every gate in `/pre-push` should fail the same way the CVE audit does — a nonzero exit that stops the push, full stop, with no "the tool crashed so I'll note it and move on" escape hatch. Concretely:

- **Lint:** `/pre-push` should treat a `pnpm lint` process crash identically to a lint *failure* — both block. It should never be possible for "the lint gate is unable to run" to be silently indistinguishable from "the lint gate passed."
- **e2e:** adopt, as a hard rule rather than a review's closing recommendation, the line the 2026-09-09 review itself proposed: **any e2e failure blocks a push.** Not "13 is roughly the same as last time." Not "these are probably pre-existing." Zero tolerance removes the judgment call that let 13 failures look like background noise for weeks.
- **Review cadence** is the one gate of the three that genuinely can't be made binary this way — there's no "build" to fail. This is why §2.1 proposes a different mechanism (an external notification) rather than trying to force it into the same shape.

**Proposed edit — `.claude/skills/pre-push/SKILL.md` (MUST):** Add an explicit rule at the top of the checklist: *"A crashing or erroring lint/test/build command is a FAIL, not a skip-and-note. Do not report `/pre-push` readiness with any step in an 'errored, unclear' state — resolve or explicitly escalate before reporting readiness."*

**Proposed edit — `.claude/skills/pre-push/SKILL.md` or `qa.md` (MUST):** Add: *"Any failing e2e test blocks sign-off, including tests that 'were already failing before this change.' If a failure is pre-existing and out of scope for the current work, it still must be triaged (real regression vs. stale fixture vs. stale assertion) before Phase 5 can PASS — not silently carried forward as acceptable background noise. See `docs/reviews/2026-09-09-test-coverage.md` for what letting this slide for 76 days actually cost."*

---

### 2.3 HIGH — The work-log-stub rule (a direct product of the last retrospective) was violated in this very session, on exactly the change type it was written for

**Evidence:** Commits `0c6e65a` ("fix(deps): patch critical Next.js RCE advisories; restore the ESLint gate") and `cc7c5e4` ("chore: clear all 24 ESLint errors surfaced when the lint gate came back") shipped **2026-09-09 with zero work-log entries.** `cc7c5e4`'s own commit message documents three genuine, non-cosmetic bug fixes gated behind "React correctness" fixes:

- `budgeting/page.tsx` and `dues-method-donut.tsx`: render-phase mutation replaced with `reduce()`.
- `use-chunked-upload.ts`: a ref read during render for `canRetry`, "safe only by accident today," fixed with real state.
- `ledger/page.tsx`'s error-boundary gap explicitly flagged as "a REAL if narrow gap" needing its own design task.

Not one of these has a work-log stub — no root cause, no reproduction, no phase-skip notation. CLAUDE.md's Bug-Fix Variant is explicit and was written for exactly this: *"Even a trivial bug fix gets a minimal work-log stub [...] the work-log is the pipeline's source of truth and an untracked fix is invisible to the next session."* This sentence exists **because of** the 2026-06-27 retrospective's Edit 4 (carried forward from 2026-06-24, applied on the third attempt). It was applied to the document and violated within roughly ten weeks, on the first bug-fix-class commit of comparable size to ship after it landed.

**By contrast, the very next day (2026-09-10) the same kind of work — lint-warning cleanup, a chunked-upload data-loss bug, a compiler-findings deferral — *did* get proper stubs** (`2026-09-10-eslint-warning-cleanup.md`, `2026-09-10-chunked-upload-retry-resume-point.md`, `2026-09-10-budget-context-panel-compiler-findings.md`, each with root cause, reproduction, and an explicit phase-skip rationale). This is not a case where the rule doesn't work — it visibly does, one day later, in the same repo, on the same kind of change. It's a case where compliance is inconsistent **within a single 24-hour window**, which is worse evidence than either "the rule is good and always followed" or "the rule is bad and never followed" — it means the rule's application currently depends on how a given piece of work gets framed (a chore/dependency-patch commit apparently reads as "not the kind of thing that needs a work-log," even when its diff contains real, documented logic bugs).

**Proposed edit — CLAUDE.md → Bug-Fix Variant (MUST):** Add a bright-line trigger, since "is this a bug fix" is evidently being under-recognized when the work is framed as a chore/dependency/lint pass:

> **The work-log stub requirement applies regardless of how the commit is framed** ("chore," "fix(deps)," "lint cleanup"). If a commit's diff contains a behavior change to application logic — not just a deletion of dead code or a mechanical rename — it needs a stub, full stop. A commit message alone is not a substitute; the stub must exist in `docs/work-log/` before the push.

---

### 2.4 MEDIUM — QA's root-cause theory in the minutes feature was confidently wrong, and the wrongness was only caught by luck-adjacent diligence

**Evidence:** In `docs/work-log/2026-09-09-minutes-browse-and-search-context.md`, Phase 5 qa found a real, reproducible defect (a glued "View 2025-26instead →" string in server-rendered HTML) and, having ruled out test-tooling and hydration artifacts through genuinely careful investigation (`od -c` on the source, three independent checks on the served HTML), concluded: *"something in the Turbopack/SWC JSX pipeline drops the space for this specific line"* and recommended a **codebase-wide grep** for the same JSX pattern as a follow-up code-review item.

The coordinator's loop-back note in the same work-log disproves this cleanly: the identical `TEXT {expr} TEXT` pattern exists one line away in the same file, same build, same render pass (`Showing {browseRows.length} of {totalCount} record{...}`), and renders correctly — plus the same pattern renders correctly in four other files. If the compiler dropped this class of whitespace, the bug would be visible across the admin portal; it isn't. The generalization was wrong, and the recommended remediation (a repo-wide sweep) would have been wasted effort chasing a theory that a five-minute grep against the qa agent's own click-through table would have falsified.

**This is not a QA competence failure — the investigative rigor that established *what* happened (byte-level, three independent verification paths) was excellent.** The failure is specifically in the step from "I have thoroughly established the symptom" to "therefore I know the cause and it generalizes" — an inferential leap the same rigor wasn't applied to. qa correctly said "root cause not chased down, out of scope for this phase" and then, in the same paragraph, stated a specific causal theory (Turbopack/SWC) and a scoped remediation (grep sweep) as if the theory were established. Both can't be true at once — either the cause is unknown (as stated) or it's known well enough to justify a targeted sweep (as recommended). The coordinator's fix was correct and cheap, but it depended on someone happening to re-read the same table two paragraphs later.

**Proposed edit — `.claude/agents/qa.md` (SHOULD):** Add to the Defect-reporting guidance:

> When a defect's proximate fix is known but its root cause is not, say so explicitly and stop there — do not pair "root cause not established" with a specific causal theory and a scoped remediation in the same write-up; those two claims are in tension and the second one will be read as established even when hedged. Before proposing any remediation broader than the single defect (a "grep the codebase for this pattern" or "audit every call site" follow-up), spend one grep confirming the pattern doesn't already appear, working correctly, elsewhere in data already collected for this same review — the click-through table is often exactly that data.

---

### 2.5 MEDIUM — Fixture pollution had become the definition of "correct," and it took a full suite reset to notice

**Evidence:** `ledger-category-management.spec.ts`'s regression baseline asserted 39 transactions, 5 budgets, and fiscal years `[2025, 2095, 2097, 2098, 2099]` for a **real** Foundation category — captured in August against an already-polluted dev database. FY2095/2097/2098/2099 are sentinel years with no legitimate data; their presence in a "ground truth" baseline for real club data is the tell. Once four budgeting suites' leftover fixture rows were actually cleaned up, the category returned to its true state (35 transactions, 1 budget, FY2025 only) and the "ground truth" test failed — for measuring reality.

This is a sharper version of the same theme as §2.2: a test suite's own accumulated mess quietly redefined what "correct" meant, and nothing caught it until an unrelated full-reset effort forced a comparison against independently-verified data. The fix applied (idempotent `beforeAll`/`afterAll` cleanup scoped by entity+fiscal-year, `e2e/helpers/ledger-fixture-cleanup.ts`) is sound and durable. Worth naming as a pattern for the code review to watch for going forward: **any e2e assertion whose expected values were "computed" by reading the current state of a shared dev database, rather than independently derived, is a latent fixture-pollution trap** — it will pass right up until the pollution it's built on gets cleaned, then fail for the wrong reason.

**Proposed edit — `.claude/agents/qa.md` (SHOULD):** Add to Regression Test discipline: *"Never derive an e2e assertion's expected value from the current live/dev database state and call it 'ground truth' — that database's current state may itself be polluted by a prior run. Compute expected values independently (from the test's own inserted fixtures, or from a source of truth outside the table under test) as the 2026-09-09 minutes suite did, not by querying the same table the assertion checks."*

---

### 2.6 LOW-MEDIUM — Process observations from this session's own execution (as reported by the coordinator, not independently re-verified by this review)

Per the brief, these are recorded as data, not re-investigated:

- **Two subagents stalled in wait loops** on background test runs and reported "still waiting" instead of a result; both had to be killed and their work manually verified. One had already produced good work it never reported. This points at a gap in how agents are instructed to monitor long-running background processes — polling with a real completion check (the `Monitor` tool's until-loop pattern) rather than an open-ended "wait and see" framing.
- **A coordinator brief said "fix the 9 remaining failures" but enumerated only 8** — two `cancel-occurrence` tests silently fell through the count/list mismatch and nothing caught it before work started. A cheap habit (the count in a summary line must equal the count of items in the accompanying list, checked before sending) would have caught this for free.
- **A subagent exceeded its brief**, converting a render-body ref write to a `useEffect` in a file never flagged for that work, changing the timing of a staleness guard in money-adjacent code. Rejected by the coordinator. This is the mirror image of the mid-flight-scope-routing gap (§4.1) — there it's a *user* adding scope that skips design review; here it's an *agent* adding scope unprompted during implementation. Both point at the same underlying principle (changes to money-adjacent logic need to go through design, not get absorbed opportunistically), but the CLAUDE.md carry-forward edit as originally scoped (Edit 3, still unapplied) only covers the user-initiated direction. Worth widening its language to cover both.
- **Date rot recurred** in `cancel-occurrence.spec.ts`: hardcoded dates were advanced once in June (per the 2026-06-24 test-coverage review) and rotted again by September. This time the fix was structural — the suite now seeds its own event with a rolling window relative to run-time `now` — rather than another one-off date bump. This is the right fix, finally applied on the second occurrence rather than the first; worth codifying so the next dated fixture doesn't repeat the same one-off-patch-then-rot cycle.

**Proposed edit — `.claude/agents/qa.md` (SHOULD):** Add to e2e authoring guidance: *"Never hardcode a specific calendar date as a test fixture boundary. Derive fixture dates relative to the run's own `now()` (as `cancel-occurrence.spec.ts` now does) so a suite that goes unrun for months does not silently rot — this has now happened twice to the same suite."*

**Proposed edit — `CLAUDE.md` → Workflow Rules (SHOULD):** Add: *"When a background process is worth waiting on, use the Monitor tool's until-loop pattern for a definite completion signal, not an open-ended wait-and-report. If a check-in reports 'still waiting' with nothing to show, treat that as a signal to verify the background work directly rather than waiting again."*

---

### 2.7 LOW — Ten of 43 lint warnings were the tooling's own fault, and a noisy gate degrades exactly the same way a broken one does

`eslint.config.mjs`'s flat-config format doesn't read `.gitignore` by default, so ESLint was linting its own `coverage/` output (an Istanbul-generated artifact, reporting a "stale eslint-disable" that nobody wrote); and `no-unused-vars` wasn't configured to honor this codebase's own `^_` "deliberately unused" naming convention, so seven bindings that already declared themselves unused (`_request`, `_k`, `_table`) were flagged as if they were bugs. Both fixed in `eslint.config.mjs`, no application code touched. Commit `0e56e68`'s own framing is the right one to keep: *"A rule that cries wolf gets ignored, which buries the genuinely dead code it exists to find."* This is the same "signal vs. noise" theme as §2.2 at smaller scale — a gate that reports false positives trains whoever reads it to skim past all of its output, real or not.

No further action needed — already fixed — but worth naming as the same species of problem as the bigger findings above, for anyone reading this retrospective for the pattern rather than the individual incidents.

---

## 3. Pipeline Efficacy — Is the Six-Phase Pipeline Earning Its Cost?

**Short answer: yes, when it's actually invoked — and the invocation discipline for the Bug-Fix Variant is where the real gap is, not the full pipeline.**

### 3.1 The full pipeline, exercised once cleanly this session, worked exactly as designed

The minutes browse-and-search feature ran analyst → architect → tech-lead → **api-developer → ux-developer** (specialist split, not full-stack) → qa → analyst, with a genuine loop-back: qa found a real defect, routed it back to Phase 4, the fix was verified, and Phase 6 correctly distinguished "the defect is fixed" from "the theorized root cause is unverified" rather than papering over the gap (see §2.4 — the theory was wrong, but the work-log's honesty about not knowing why is itself evidence the discipline is working at the sign-off layer, even where it slipped at the investigation layer). The specialist split produced ~28 named unit tests in the server slice with a real correctness catch pinned in the design doc before implementation (the `meetingDate` UTC-parsing risk, a recurrence of a bug class this project has hit multiple times before — caught in *design*, not in production, this time).

This is one clean data point in this specific session, but it sits on top of the 2026-06-27 retrospective's own finding that the specialist split had already become the de facto path for every Ledger increment across the prior window (7 features, zero use of full-stack-developer for anything of that size) — so it is not a single isolated success; it's a continuation of an established, working pattern.

### 3.2 The Bug-Fix Variant is where discipline is inconsistent, not the full pipeline

Every full-pipeline or properly-stubbed Bug-Fix Variant entry this session is a model example (the HEIC/CSP regression's work-log documents root cause, reproduction, and an explicit "why Phase 1-3 skipped" note; same for the chunked-upload fix and the compiler-findings deferral). The gap is entirely in the two commits that skipped the stub *and the routing decision itself* — nobody decided "this is bug-fix-variant, skip 1-3, write a stub"; the work simply happened without the pipeline being invoked as a concept at all (§2.3). That is a different failure from "the pipeline doesn't work" — it's "the pipeline wasn't consulted."

### 3.3 Verdict

Don't weaken the pipeline. The evidence this window (both the specialist-split continuation and the one full run examined in detail) says it's working. The fix belongs in §2.3's proposed edit — making the work-log-stub trigger independent of how a commit happens to be framed — not in loosening any phase.

---

## 4. Carry-Forwards at 2+ Cycles

### 4.1 MUST, now unactioned across the entire 75-day gap: mid-flight scope routing rule (Edit 3, 2026-06-27 retrospective)

Never applied. No trace anywhere in CLAUDE.md. This was the **only new MUST** in the last retrospective (the others were escalated SHOULDs), proposed specifically because three of seven Ledger-window features absorbed user-added scope without looping back through Phase 3, with a concrete example (the dues-tracking `is_active` fiscal-year column) of scope that should have triggered a design revision and didn't. With 103 work-log files in the intervening 75 days, this is very likely to have recurred without anyone checking — this retrospective did not have budget to re-audit all 103 for the pattern, and that itself is worth naming: **the longer a MUST carry-forward goes unapplied, the more shipped work exists that was never checked against it.** Recommend the next agent-instruction or code review specifically sample a handful of the 103 work-logs for evidence of unrouted mid-flight scope, now that the rule (once applied) would give them something concrete to check against.

**Reapply as originally proposed, widened per §2.6's observation** to cover both user-initiated and agent-initiated scope creep:

> **Mid-flight scope additions:** If scope is added after Phase 3 is complete — by the user, or by an implementing agent noticing an adjacent improvement — route it based on size: purely additive/no schema/no new API/<30 lines may be absorbed inline with a work-log note; a new schema column, API endpoint, or UI page must loop back to Phase 3; a new user-facing flow or permission must loop back to Phase 1. This applies equally when the added scope originates from an agent's own judgment during implementation, not only from the user — an implementer noticing "this related thing should also change" is scope creep with the same risk profile as a user asking for more mid-flight, and the 2026-09-09 session had an example of exactly that (a rejected unprompted `useEffect` refactor to a money-adjacent staleness guard).

### 4.2 LOW, at 2+ cycles: `architect.md` should label Phase-2 migration numbers as tentative (Finding 4b, 2026-06-27 agent-instruction review)

Still not applied (`database-admin.md`'s side of this pair *was* applied — "pick the migration number at the start of Phase 4" — so the collision risk is mitigated from the implementer side even without the architect-side note). Low urgency given the mitigation already in place; still worth closing for completeness.

### 4.3 Newly surfaced but worth flagging as a carry-forward risk before it becomes one: the four hygiene reviews that went dark together

Not a carry-forward in the technical sense (nothing was "proposed and not applied" — the reviews simply didn't run), but structurally identical to one: a known-good practice that requires an active choice to keep exercising, with no enforcement, quietly lapsing under sustained feature-shipping pressure. §2.1's proposed fix is aimed at preventing this from being reported as "nothing to see here, we just do these ad hoc" in three months.

---

## 5. What's Being Over-Engineered for a Volunteer Club Site

Asked for directly — answering plainly.

**The minutes browse-and-search feature is disproportionate to its risk.** This is a page a member visits to skim meeting minutes, currently holding 49 rows total, growing by ~24/year. The shipped work for "add year pills and make search results visibly distinct from browsing" is a 1,486-line work-log, an architect-level ruling on query decomposition (three-way join elimination), ~28 named unit tests covering fiscal-year boundary math and snippet-extraction edge cases, a 621-line, 21-test dedicated e2e suite, and — when one link's text rendered with a missing space — a qa investigation that went to the level of `od -c` byte inspection of the compiled `.tsx` source and a raw authenticated `fetch()` of the server-rendered HTML to rule out a hydration artifact. That level of rigor is exactly right for the Ledger (real money, IRS 990 compliance, audit trail, a treasurer's legal exposure) and is more than this feature's actual risk profile justifies — a member seeing a glued word for a day, or a search snippet occasionally showing the wrong matched field, has no cost remotely close to a books-balancing error. The ceremony cost (six-phase pipeline, full architect ruling, specialist split, near-30-test suite) is currently uniform across the whole project regardless of blast radius, and this feature is the clearest evidence that uniformity is the wrong shape.

**Concretely, this suggests a third variant, not just "Full" and "Bug-Fix":** something like a **Small Enhancement variant** — additive UI/UX changes to non-financial, non-PII, already-ungated pages, with no schema change and no new permission, get a lighter Phase 2/3 (a paragraph each, not a ruling with named sub-decisions) and qa verification proportionate to blast radius (a handful of Playwright assertions for the actual new behavior, not an exhaustive matrix of fiscal-year boundary conditions for a 49-row list). The existing Bug-Fix Variant already draws exactly this kind of proportionality distinction for fixes; there's no equivalent for small *additive* features, and the minutes-browsing work is a clean example of a feature that got Full-pipeline ceremony sized for a system with real financial/compliance stakes, applied to a page with neither.

**A second, smaller instance:** the qa root-cause investigation in §2.4 is itself a case of effort exceeding the stakes — three independent verification methods to establish that a space was genuinely missing from server-rendered HTML (a claim that was, at that point, already well-established by the first method) before pivoting to a theory that turned out wrong anyway. The rigor was appropriate for ruling out "is this real," not for the amount spent chasing "why," on a cosmetic one-character defect.

**Not over-engineered, by contrast:** the Ledger's entire specialist-split discipline, the CVE gate, the chunked-upload fix's extraction into three testable pure functions (a genuine data-loss bug in a 25MB-file retry path — proportionate rigor for the actual risk), and the fixture-pollution cleanup work. These are all cases where the ceremony matches the stakes.

**Proposed edit — CLAUDE.md → Development Pipeline (SHOULD, new):** Add a third variant table row alongside the Bug-Fix Variant description:

> **Small Enhancement Variant:** For additive, non-financial, non-PII UI/UX changes with no schema change and no new permission (e.g., adding a filter or display affordance to an already-shipped, already-gated page), Phase 2 and Phase 3 may be brief (a paragraph each) rather than full design-doc ceremony, and Phase 5's test matrix should be sized to the feature's actual blast radius rather than defaulting to exhaustive edge-case coverage. Document the scoping decision in the work-log rather than skipping phases silently — this is a *lighter* Full pipeline, not a skip.

---

## 6. Proposed Edits Summary

| # | File | Severity | Change | Status |
|---|------|----------|--------|--------|
| 1 | `CLAUDE.md` → Periodic Reviews → Cadence Check | MUST | Name multi-review overdue state explicitly as a distinct, worse signal than a single lapse | new |
| 2 | *(flag for user/architect, not a CLAUDE.md edit)* | — | Evaluate a scheduled (`schedule` skill) weekly cadence-audit notification, independent of session-start honor system | new — needs an ownership decision, not applied here |
| 3 | `.claude/skills/pre-push/SKILL.md` | MUST | A crashing/erroring lint or test command is a FAIL, never a skip-and-note | new |
| 4 | `.claude/skills/pre-push/SKILL.md` or `qa.md` | MUST | Any failing e2e test blocks sign-off, including "pre-existing" failures — must be triaged, not carried forward | new |
| 5 | `CLAUDE.md` → Bug-Fix Variant | MUST | Work-log stub required regardless of commit framing ("chore," "fix(deps)," etc.) if the diff changes application behavior | new — direct response to a same-session violation |
| 6 | `CLAUDE.md` → Phase 4 (mid-flight scope) | MUST | Reapply Edit 3 from 2026-06-27, widened to cover agent-initiated scope creep, not just user-initiated | **3rd attempt — was MUST at 3 cycles in June, never applied since** |
| 7 | `.claude/agents/qa.md` | SHOULD | Don't pair "root cause unestablished" with a specific causal theory + broad remediation in the same write-up; grep-check a theory against already-collected data before generalizing | new |
| 8 | `.claude/agents/qa.md` | SHOULD | Never derive an e2e "ground truth" assertion from current dev-DB state; compute expected values independently | new |
| 9 | `.claude/agents/qa.md` | SHOULD | Never hardcode calendar-date fixture boundaries; derive relative to run-time `now()` | new |
| 10 | `CLAUDE.md` → Workflow Rules | SHOULD | Use Monitor's until-loop for background waits; treat a bare "still waiting" check-in as a cue to verify directly | new |
| 11 | `CLAUDE.md` → Development Pipeline | SHOULD | Add a "Small Enhancement Variant" sized to blast radius, distinct from Bug-Fix Variant | new |
| 12 | `architect.md` | LOW | Label Phase-2 migration numbers as tentative (Finding 4b, 2026-06-27 agent-instruction review) | carry-forward, 2+ cycles |

---

## 7. Items to Watch at Next Retrospective

**Next retrospective due:** 2026-09-17 (7-day cadence) — flagging directly: given this window's own finding, do not let this date slip the way 2026-06-27's did.

- Did Edit 6 (mid-flight scope routing, now on its 3rd proposal) finally land, and — more importantly — is there any evidence from the intervening week's work-logs that it was actually consulted, not just present in the file?
- Did Edits 3/4 (pre-push hard-fail on crash/e2e-failure) land, and did a subsequent push actually get blocked by either, proving the rule has teeth rather than being aspirational text?
- Did documentation, code, and agent-instruction reviews — all three still overdue as of this writing — get run? (They were not in scope for this retrospective's remit and remain open.)
- Was the "Small Enhancement Variant" concept (Edit 11) evaluated, and if adopted, did the next small additive feature actually get the lighter treatment, or did old habit reassert Full-pipeline ceremony regardless of the new option existing?
- Any recurrence of a work-log-less bug-fix-class commit (the exact failure this retrospective's Edit 5 targets)?

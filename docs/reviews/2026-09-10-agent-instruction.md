# Agent & Instruction Review — 2026-09-10

**Cadence:** 30 days. **Last run:** 2026-06-27 — **75 days overdue.** This is the most overdue this review has ever been; see "On the cadence miss" at the end.

**Outcome:** 1 high, 3 medium, 3 low findings. 7 direct corrections applied to `.claude/agents/`. 3 process-level proposals written up for `.claude/skills/pre-push/SKILL.md` but deliberately **not** applied (they change what the push gate blocks on — see Standards note in my brief). All three 2-cycle SHOULD carry-forwards from 2026-06-27 are now resolved in `CLAUDE.md`. One 2-cycle LOW carry-forward (migration-number tentativeness note in `architect.md`) was still open and is now applied. One brand-new HIGH finding (`ux-developer.md`'s hex color values have been wrong since the file was created, missed by both prior review cycles).

---

## Scope

Files examined:
- `.claude/agents/` — all 9 agent files, full text
- `.claude/skills/` — all 5 `SKILL.md` files, full text
- `.claude/settings.local.json` (the only `settings*.json` present; project-level, gitignored)
- `docs/reviews/2026-06-27-agent-instruction.md` and `2026-05-27-agent-instruction.md` (baseline)
- `docs/reviews/log.md` (full history)
- `docs/decisions.md` (tail, for context on today's session's incidents)
- `docs/work-log/2026-09-09-minutes-browse-and-search-context.md` (1485 lines — specialist-split evidence, qa root-cause incident)
- `docs/work-log/2026-09-09-heic-csp-wasm-regression.md`, `2026-09-10-chunked-upload-retry-resume-point.md`, `2026-09-10-eslint-warning-cleanup.md`, `2026-09-10-budget-context-panel-compiler-findings.md` (this week's other work — scope-discipline incident, lint-gate incident)
- `tailwind.config.ts` (ground truth for brand hex values)
- `package.json`, live `git log`, and a live `pnpm lint` run (to verify the ESLint-gate incident independently rather than trust the brief)
- `CLAUDE.md` (read-only — owned by the concurrent documentation review; I did not edit it, only checked whether the agent/skill layer is consistent with it)

I did not touch `CLAUDE.md`, `docs/reviews/log.md`, or `src/`, per my brief.

---

## Prior-Cycle Carry-Forwards: Status Check

| Proposed edit | Source | Status |
|---|---|---|
| `api-developer.md` / `full-stack-developer.md` — Phase-3 test-deliverable checklist | 06-27 MUST | Applied (verified present in both files) |
| `architect.md` — replace `xlsx` with `exceljs` in "Already available" | 06-27 MUST | Applied (verified: list now shows `exceljs`, no `xlsx`) |
| `CLAUDE.md` — specialist split vs. full-stack-developer guidance | 06-27 SHOULD, 2 cycles | **Now applied.** `CLAUDE.md` § Phase 4 carries the exact "Specialist split vs. full-stack" paragraph proposed in 06-27. |
| `CLAUDE.md` — deployment-engineer is reactive, not "Pre-deploy" | 06-27 SHOULD, 2 cycles | **Now applied.** Agent Roster row reads "Reactive... `/pre-push` covers the routine pre-deploy checklist." |
| `CLAUDE.md` — Bug-Fix Variant work-log stub requirement | 06-27 COULD, 2 cycles | **Now applied.** "Skipping a phase requires explicit notation... even a trivial bug fix gets a minimal work-log stub." Confirmed in practice too — both bug-fix work-logs from this week (`2026-09-09-heic-csp-wasm-regression.md`, `2026-09-10-chunked-upload-retry-resume-point.md`) carry exactly this stub shape. |
| `database-admin.md` — re-derive migration number at Phase 4 start | 06-27 LOW | Applied (verified present, worded almost exactly as proposed) |
| `architect.md` — note that a proposed migration number is tentative | 06-27 LOW | **Was still open** (1 cycle late). Applied this cycle — see Findings. |
| `add-permission` SKILL.md — remove stale "if CLAUDE.md maintains an inventory" line | 05-27 LOW, then 06-27 LOW (2 cycles) | Applied (verified: Step 6 no longer contains the sentence) |
| Merge documentation review + agent-instruction review (informational, 05-27) | 05-27, informational | Not adopted. Still running as two separate passes 4 cycles later — see "Worth simplifying" below. |

**Every MUST and SHOULD carry-forward from the last two cycles is now resolved.** This is a genuinely clean carry-forward slate — first time in three cycles. The one exception (architect.md migration-tentative note) was a LOW item that slipped one cycle; it's fixed now, below.

---

## Findings

### HIGH — `ux-developer.md` has had the wrong brand hex values since the file was created; missed by two prior review cycles

**Location:** `.claude/agents/ux-developer.md`, "Visual Style — Lions Club" section.

**Before this fix**, the file read:

> **Primary:** `lions-blue` (`#1a56db`). **Accent:** `lions-gold` (`#FFD700`). **Dark:** `lions-blue-dark` (`#1e40af`)...

**Actual values** (`tailwind.config.ts`, the documented source of truth per `CLAUDE.md`):

```
"lions-blue":      "#003F87"
"lions-blue-dark": "#002d63"
"lions-gold":      "#F9B222"
"lions-gold-dark": "#e09d0f"
```

Every number was wrong — not a typo in one digit, a different palette entirely (a lighter blue and a bright yellow-gold vs. the actual navy/amber). The file has existed since 2026-05-18 and was marked "Accurate... consistent with CLAUDE.md UX Guidelines" as "Checked and Clean" in both the 2026-05-27 and 2026-06-27 reviews — neither cycle actually diffed the hex values against `tailwind.config.ts`.

**Why it hasn't bitten yet:** every actual usage in the codebase and in the agent files themselves goes through the Tailwind class name (`bg-lions-blue`, `text-lions-gold`), never the raw hex. So no shipped pixel is wrong. But this is the one file a `ux-developer` agent reads to learn the palette, and the moment an agent needs to reason about contrast, produce a non-Tailwind context (an email HTML template inline style, a chart color, a favicon), or answer "what blue is this," it would confidently produce the wrong color from its own reference doc.

**Applied:** corrected all three hex values in `ux-developer.md`, and added a pointer to `tailwind.config.ts` as the source of truth (mirroring the note `CLAUDE.md` itself carries) so the next drift is self-correcting.

**Process note:** this is exactly the kind of error a "Checked and Clean" verdict without an actual diff will miss twice. I did not check every other numeric/factual claim in every agent file against source this cycle either — I spot-checked the ones the brief and the carry-forward list pointed at. A more systematic "diff every quoted constant against its source file" pass is possible but is more process than this project's size warrants as a standing requirement; flagging it here so the next cycle's reviewer knows this class of error exists and got past two reviews already.

---

### MEDIUM — `qa.md` had no discipline for separating a verified defect from a theorized root cause; the gap produced a live near-miss this week

**Location:** `.claude/agents/qa.md`.

**What happened (from `docs/work-log/2026-09-09-minutes-browse-and-search-context.md`, Phase 5 / loop-back sections):** qa found a real, well-verified defect — glued link text (`"View 2025instead →"`) — confirmed three independent ways including a raw `fetch()` of the server response outside the browser, ruling out a hydration artifact. That part of the work was genuinely good. qa then theorized the cause was "something in the Turbopack/SWC JSX pipeline drops the space for this specific line" and recommended a **repo-wide grep** for the pattern as a follow-up.

The coordinator's loop-back note disproved the generalization using evidence already present in the same file: `page.tsx:374`, same file, same build, same render pass, uses the identical `TEXT {expr} TEXT` JSX pattern and — per qa's own click-through table — renders correctly. The same pattern appears cleanly elsewhere in the codebase too (`about/page.tsx:179`, `members/dues/page.tsx:197`, and others). If the compiler dropped spaces for this pattern generally, those would show the same defect. They don't. The repo-wide sweep was never justified by the evidence qa itself had gathered, and was correctly not actioned.

**The gap:** nothing in `qa.md` distinguished "I verified this" from "I believe this is why," or required checking a general theory against a counter-example already on hand before recommending codebase-wide follow-up work. The defect-finding was excellent; the root-cause claim rode along without the same bar and nearly produced a wasted repo-wide hunt for a bug that (on the file's own evidence) isn't general.

**Applied:** added a "Verified Fact vs. Root-Cause Theory" subsection to `qa.md`'s verdict section, requiring the two claims be labeled separately and requiring a theory be checked against same-file counter-evidence before it's used to justify a wider sweep.

---

### MEDIUM — no agent guidance against silently parking on a long-running verification step; happened twice this session

**Location:** `.claude/agents/qa.md`, `.claude/agents/deployment-engineer.md`.

Per this session's own observation (not independently re-verifiable from work-log text, since a stalled subagent that gets killed doesn't leave its own record): two subagents launched a long-running background check (a build or an e2e run) and then reported "still waiting" instead of a result, with one having actually completed useful, correct work that was never surfaced because the agent was still blocked on the rest of the run. Both had to be killed and their work verified by the coordinator by hand.

`qa.md` and `deployment-engineer.md` are the two agents most likely to run a genuinely long verification step (`pnpm build:only`, `pnpm test:e2e`). Neither file said anything about how to handle a check that takes real wall-clock time — the implicit assumption was a request/response tool call, which doesn't match how a multi-minute build or e2e suite actually behaves under this harness's background-task tooling.

**Applied:** added a short "Long-Running Verification" note to both files — prefer the foreground when possible; if backgrounded, check on it actively and report partial, already-verified results rather than going silent until the whole thing resolves.

**Scope note:** I kept this addition short and placed it only in the two agents that actually run long checks, rather than adding it project-wide (e.g., to `CLAUDE.md`'s Workflow Rules) — that's the documentation review's file, not mine, and a two-agent-scoped fix is proportionate to a two-incident problem.

---

### MEDIUM — no scope-discipline guardrail for money-adjacent code; a risky fix was attempted (and self-caught) this week

**Location:** `.claude/agents/api-developer.md`, `.claude/agents/full-stack-developer.md`.

Per `docs/work-log/2026-09-10-eslint-warning-cleanup.md` and `docs/work-log/2026-09-10-budget-context-panel-compiler-findings.md`: while clearing ESLint warnings (a mechanical, no-Phase-1-3 task per the work-log's own scoping), the obvious fix for `budget-context-panel.tsx`'s stale `eslint-disable` directive would have been to remove it and move a render-body ref write (`currentFiscalYearRef.current = ...`) into a `useEffect`. That ref is a documented fiscal-year staleness guard in treasurer-facing budget tooling — moving the write changes *when* the guard updates, from during render to after commit. The full-stack-developer prototyped this, recognized it as a behavior change rather than a cleanup, and reverted it via `git checkout --` rather than landing it, leaving the single warning open with a written explanation instead.

This is a good outcome — the agent caught its own overreach and the work-log documents exactly why, including an explicit "do not delete this directive" warning for the next person. But it worked because of good in-the-moment judgment, not because either agent file said anything about the risk class. The same instinct that says "the lint rule wants X" can just as easily win next time without a specific guardrail naming what's different about money-adjacent code.

**Applied:** added a short "Scope discipline near financial code" note to both `api-developer.md` and `full-stack-developer.md` — a narrowly-scoped task doesn't license a behavioral change in Ledger/dues/reimbursement code, even a one-line one; if the "obvious" fix touches money-adjacent behavior, stop and route it through Phase 1-3 instead of applying it inline. (`ux-developer.md` wasn't included — this incident and its shape are specifically about server/business logic, not UI.)

---

### LOW (carry-forward, now applied) — `architect.md` never got the "migration number is tentative" note proposed in 2026-06-27

**Location:** `.claude/agents/architect.md`.

This was proposed alongside the `database-admin.md` fix in the last cycle (both halves of the same finding — a migration-number collision between two parallel increments). `database-admin.md` got its half (re-derive the number at Phase 4 start); `architect.md` never got its half (don't present a Phase 2 migration number as settled). One cycle late but zero real-world cost — `database-admin.md`'s fix alone already prevents the actual collision; this half is belt-and-suspenders for the Phase 2 output's own honesty.

**Applied:** added a short note to `architect.md` under a new "Migration Numbers Are Tentative in Phase 2" heading.

---

### LOW — tech-lead.md didn't name the specialist-split success as a concrete precedent when nominating an implementer

**Location:** `.claude/agents/tech-lead.md`.

The specialist split (api-developer → ux-developer) ran for real this week on the minutes browse/search feature, after the 2026-05-27 retrospective called it "a paper fiction" (full-stack-developer had owned 9/10 Phase 4s at that point) and the 2026-06-27 cycle found it had become the de facto path for large Ledger increments. `CLAUDE.md` already carries the resulting guidance (the "Specialist split vs. full-stack" paragraph, confirmed applied above), and `full-stack-developer.md`'s 150-line threshold already points the same direction. The gap was narrower than "the rule doesn't exist" — it's that `tech-lead.md`, the file that actually writes the nomination in each work-log, didn't cite the pattern as a working precedent, so each nomination decision was re-derived from the general rule rather than from "this has worked."

**Applied:** added one sentence to `tech-lead.md`'s nomination guidance citing the 2026-09-09 minutes feature by name as the precedent for choosing the split when there's a real API contract to hand off.

---

### LOW — `.claude/settings.local.json` carries four scratch permission entries tied to a specific past debugging session

**Location:** `.claude/settings.local.json`.

```json
"Bash(pnpm build:only)",
"Bash(echo \"EXIT:$?\")",
"Bash(grep -iE \"error|fail\" /tmp_build_check.log)",
"Bash(echo \"EXIT CODE: $?\")",
"Bash(grep -n \"admin/welcome-packets\\\\b\\\\|welcome-packets/new\\\\|welcome-packets/\\\\[id\\\\]\" /tmp_build_output.txt)",
"Bash(head -80 /tmp_build_output.txt)",
"Bash(rm -f /tmp_build_output.txt)"
```

These are auto-accumulated "don't ask again" allowlist entries from a prior session's specific debugging commands (a `welcome-packets` build investigation), not general-purpose permissions and not shared instruction content — the file is gitignored (`.gitignore_global` line 4) and local-only. Not a finding against the shared instruction layer; noting it only because the brief asked me to check `settings*.json`. **Not touching it** — it's a live, in-use local file during a session with other concurrent agents active, and cleaning stale one-off command grants isn't worth the risk of interfering with another agent's in-flight permission state.

---

## Proposals — NOT applied (these change what the push gate blocks on)

Per my brief's standard ("anything that changes how the project works, rather than fixing stale instruction text, is a proposal, not an applied edit"), the following three go to `.claude/skills/pre-push/SKILL.md` — the most operationally sensitive file I reviewed, since it gates every push to `main`. I verified all three independently before writing them up.

### PROPOSAL 1 (traces to a real 5-day production regression) — `/pre-push` has no lint step at all, and no gate distinguishes "ran clean," "ran and found problems," and "didn't run"

**Verified independently:** `.claude/skills/pre-push/SKILL.md` (all 211 lines, Steps 1–12) never invokes `pnpm lint`. It never has — `git log --oneline -- .claude/skills/pre-push/SKILL.md` shows no commit ever added one. `package.json` has had a `lint` script since before this pipeline existed.

**What actually happened this week**, per `git log` and `docs/work-log/2026-09-10-eslint-warning-cleanup.md`: `pnpm lint` was crashing outright (exit 2 — a config/loader failure, not lint findings) for an unknown period, most recently because a CVE-motivated `minimatch` override broke `@eslint/eslintrc`'s import shape, compounding with an ESLint-config-next v16 flat-config incompatibility. Because `/pre-push` never ran lint, nobody's push was ever blocked by this, and nobody noticed — the gate wasn't failing, it simply wasn't present. When `pnpm lint` was repaired (commit `0c6e65a`), it immediately surfaced 24 real errors and, after cleanup, exposed a genuine missing-loading-indicator bug and a genuine display bug that had shipped silently (`docs/work-log/2026-09-10-eslint-warning-cleanup.md`, "three admin defects found clearing the lint backlog," commit `0e56e68`). This is the incident the brief calls "the single change most directly implicated in a real production regression surviving five days" — I'd sharpen that: it's not just that a crashed gate looked like a passed gate, it's that **there was no gate to crash** in the documented pipeline at all. `pnpm lint` was apparently being run by habit or by a different, undocumented path, not by `/pre-push` itself.

**Proposed fix — two parts:**

1. **Add a lint step.** Insert a new step after the current Step 3 (Type Check) and before Step 4 (Unit Tests):

   ```markdown
   ## Step 3.5: Lint

   ```bash
   pnpm lint
   ```

   If it fails, first determine **which** kind of failure this is before reporting it (see the "gate could not run" principle below) — a config/loader crash and a set of real findings look different in the output (a crash produces a stack trace or "Error:" before any file is linted; real findings produce a list of file:line rule violations after linting completed). Report the distinction, not just pass/fail.

   **Do not proceed if lint reports errors, and do not silently proceed if lint could not run.**
   ```

2. **Give the summary (Step 12) a third outcome, not just PASS/FAIL, for every gate that can crash rather than fail:** `PASS`, `FAIL (N findings)`, or **`COULD NOT RUN`** (config error, missing dependency, crashed before producing findings). Apply this to lint at minimum; the same three-way split is worth considering for the unit-test and e2e steps too, since a config-level crash in either would currently be indistinguishable from "0 tests ran, nothing to report" in a fast read of the output. `COULD NOT RUN` still blocks the push — the point isn't to be more lenient, it's that "the gate is broken" and "the code has a problem" need different remediation, and only one of the two is actually about the change being pushed.

**Why this is a proposal, not an applied edit:** this adds a new blocking check to a gate real pushes go through. Getting the wording or the pass/fail boundary wrong here has a direct operational cost (a false block on every future push, or a false pass that repeats this exact incident). Recommend the user or `tech-lead` review the exact step wording before it lands.

---

### PROPOSAL 2 — the PII sweep's phone/address patterns flag legitimate public-business listings as hard stops

**Verified independently:** Step 9's phone regex (`\b[0-9]{3}-[0-9]{3}-[0-9]{4}\b` etc.) and address regex both match real content in `drizzle/migrations/0034_glasses_dropoff_refresh.sql` — 15 phone numbers and 2 street addresses belonging to third-party businesses (eyecare practices, a library branch, a church, a senior center) that operate the club's eyeglass-donation drop-off network. These are already public — the same data renders on the public `/programs` page via `dropoffLocations` — and belong to businesses and institutions, not private individuals. Combined with the smaller `0029_glasses_dropoff_locations.sql` seed, this is 17 hits, matching the brief's figure.

`CLAUDE.md`'s *No Personal Data in the Repository* invariant is about member and private-individual data — it was never meant to ban a business's own published storefront phone number, and nothing in the skill currently tells a reviewer that. A gate that reliably produces 17 false positives on a known-clean, already-public dataset trains whoever runs it to skim past the "hard stop" rather than read every hit — which is exactly the failure mode that let a real `.env.local.bak` leak through on 2026-08-12 (the incident that motivated this step in the first place).

**Proposed fix (guidance, not a narrower regex — narrowing the pattern risks missing real personal data in a similar shape):** add a paragraph immediately after the three grep commands in Step 9:

```markdown
**Before treating a phone or address hit as a violation, check what it belongs to.**
A business or institution's own published contact information — e.g. the eyeglass/plastic
drop-off location directories seeded in `drizzle/migrations/0029_glasses_dropoff_locations.sql`,
`0034_glasses_dropoff_refresh.sql`, and `0039_plastic_dropoff_locations.sql`, rendered on the
public `/programs` page — is not personal data under CLAUDE.md's *No Personal Data* invariant,
which targets members and private individuals. A hit inside a location-directory migration or
script, where the entity name is a business/organization and the destination page is public,
is presumptively this category. Confirm both conditions before clearing it — a hit next to a
person's name, or inside a members/dues/reimbursement context, is still a hard stop regardless
of formatting.
```

**Why this is a proposal, not an applied edit:** this changes what causes the PII gate to hard-stop a push — exactly the kind of process change my brief asks me to propose rather than apply. It's also worth a second pair of eyes given the gate exists because of a real credential leak; I'd rather the user confirm the carve-out's boundary than have me narrow a security gate unilaterally.

---

### PROPOSAL 3 — tie the periodic-review cadence check to `/pre-push` instead of relying only on session-start vigilance

**The data:** `docs/reviews/log.md` shows this review 75 days overdue; the 2026-09-09 test-coverage review found the e2e suite "had not been run cleanly in a while" (turned out to be ~76 days) and that gap let a real production regression (the HEIC/CSP WASM break) survive 5 days before an unrelated coverage sweep caught it. `CLAUDE.md`'s "Cadence Check at Session Start" already says the right thing — check `docs/reviews/log.md` at the start of non-trivial work and surface anything overdue — but it drifted 43–76 days across five different review types anyway.

**Read on why the existing mechanism isn't enough:** it depends on a session happening to start with "non-trivial work" framing, and on the assistant actually running the check that turn. A run of pure bug-fix sessions (which this project has had plenty of, per the Bug-Fix Variant table) can each individually look "trivial" enough to skip the check, while the aggregate drift accumulates unnoticed. `/pre-push` is different: it's the one checkpoint that unconditionally runs before *every* push regardless of how small any single session felt, so it doesn't depend on remembering to invoke it for the right reason.

**Proposed fix — advisory only, does not block the push:** add to Step 11 (Housekeeping Sweep) or as a new line in Step 12's summary:

```markdown
- **Review cadence:** read `docs/reviews/log.md`, compare the most recent date for each
  review type against its cadence in CLAUDE.md → Periodic Reviews, and list any that are
  overdue. This does not block the push — it's a nudge, not a gate — but surfacing it at
  the one checkpoint every push goes through catches drift a "did I remember to check at
  session start" habit won't.
```

**Why this is a proposal and not applied, and why I'm not fully confident it's worth doing at all:** I want to flag the honest tension rather than resolve it for the user. This *is* more process on a volunteer-run club site, even though it's non-blocking. The counter-argument: if the user is going to override an overdue-review nudge anyway (which `CLAUDE.md` already explicitly allows — "If the user says proceed, do not append a fake log entry"), printing the same nudge from two places doesn't change the outcome, it just prints it twice. The actual gap isn't "nobody sees the nudge" — the session-start version does fire — it's that it fires inconsistently depending on session framing. Moving or duplicating it to `/pre-push` fixes that inconsistency at the cost of one more advisory line in an already-long Step 12 summary. I lean toward doing it (the incremental cost is one read of a file that's already small and one comparison against a table that already exists), but this is closer to a judgment call than the other two proposals and I'd rather the user weigh in than have me decide unilaterally on a workflow-rule question that's really `CLAUDE.md`'s territory more than the skill's.

---

## Worth simplifying (not just adding)

Per my brief's explicit ask to flag removal/simplification candidates, not just additions:

**The documentation review and agent-instruction review still run as two separate monthly passes with substantially overlapping scope**, four cycles after this was first raised as an informational observation (2026-05-27, Finding 4: "both audit agent files and `CLAUDE.md`... redundant to run as separate passes on the same day"). Today's session ran exactly that scenario — a concurrent documentation review and this agent-instruction review, both reading `CLAUDE.md`, both reading agent files, both owned by `tech-lead`, running in parallel and having to explicitly carve up which of us touches which files to avoid collision (I was told not to touch `CLAUDE.md`; the concurrent review presumably owns it). That coordination overhead is itself evidence for the merge. I'm not applying this — it's a `CLAUDE.md` → Periodic Reviews table change, not mine to make — but four cycles of the same observation going unadopted is itself worth a data point: either merge the two reviews into one "30-day instruction layer review," or explicitly decide not to and stop carrying the tension forward as an open question every cycle.

**I looked at, and am not recommending, consolidating the repeated code-pattern blocks** (auth check, feature gate, `sendEmail()`, `ConfirmDialog`) that appear near-verbatim across `api-developer.md`, `ux-developer.md`, and `full-stack-developer.md`. This looks like the kind of duplication `CLAUDE.md`'s own "Duplication Is a Review Finding" rule would flag in application code, but agent files aren't application code: each one is loaded into a fresh subagent with zero shared context, so each needs to be self-contained rather than pointing to "see api-developer.md for the pattern." The duplication here is buying independence, not costing correctness — none of the three copies has drifted from the others. Leaving as-is.

**No agent file, skill, or the settings file references a feature, tool, or command that no longer exists.** This was the other half of my brief's scope (stale references to dead features) and I found nothing beyond the `ux-developer.md` hex-value issue above — every `pnpm` command, file path, and `FEATURES` pattern I spot-checked against the live codebase was accurate.

---

## On the cadence miss

This review was 75 days overdue — worse than the 06-27 cycle's own note that reviews were already drifting. I'm not proposing a new mechanism beyond Proposal 3 above (which I've deliberately left as an open question rather than a confident recommendation). The honest read: this is a volunteer-run club site, the user has been shipping real, substantial features and a large cleanup in the meantime (the Ledger buildout, the minutes browse/search feature, the CSP regression fix, the ESLint-gate restoration — all real value), and a 30-day instruction-layer audit is reasonably the thing that slides when there's a choice between it and shipping. The finding worth taking seriously isn't "run this review more punctually" — it's that **the two things this exact review would have caught earlier (the dead ESLint gate, the wrong `ux-developer.md` colors) both sat for weeks-to-months without user-visible harm**, which is some evidence the current cadence, even followed late, is still fast enough for a project this size. I'd rather say that plainly than manufacture urgency the evidence doesn't support.

---

## Checked and Clean

| File | Verdict |
|------|---------|
| `analyst.md` | Accurate. Five-pass structure, surface taxonomy, Phase 1/6 bodies consistent with `CLAUDE.md`. No stale references. |
| `database-admin.md` | Accurate. Migration-number re-derivation note (06-27 carry-forward) confirmed present and correctly worded. |
| `api-developer.md` | Accurate; scope-discipline note added (Finding above). Route/auth/`sendEmail()` patterns match the live codebase. |
| `ux-developer.md` | Hex values corrected (Finding above); everything else — card/button classes, focus rings, component conventions — matches `CLAUDE.md` UX Guidelines exactly. |
| `full-stack-developer.md` | Accurate; scope-discipline note added. 150-line threshold and cross-references to api-developer/ux-developer still correct. |
| `deployment-engineer.md` | Accurate; long-running-verification note added. External-System-Failures section (Vercel duplicate-account) still correctly framed as informational, not re-triggered this cycle. |
| `qa.md` | Two additions (root-cause discipline, long-running verification); everything else — coverage targets, verification stack, feature-gate audit — still matches the live test setup. |
| `tech-lead.md` | One addition (specialist-split precedent); design doc template and ownership section otherwise accurate. |
| `architect.md` | Two additions (migration-tentative note, applying the last open 06-27 carry-forward); dependency list, directory rules, route-group rules all match `src/`. |
| `neon-postgres` skill | Accurate. Commands, pooling guidance, branching workflow all match the project. |
| `new-feature` skill | Accurate. Pipeline table matches `CLAUDE.md` exactly. |
| `release-notes` skill | Accurate. Template structure and the "no file lists" rule match actual release notes. |
| `add-permission` skill | Accurate — the 2-cycle-stale line is gone (carry-forward, confirmed above). |
| `pre-push` skill | Three proposals above (not applied); everything else (Steps 1–2, 5–7, 10–11) verified accurate against the live build/migration/release-notes workflow. |

---

## Summary of Applied Edits

| # | File | Change |
|---|------|--------|
| 1 | `.claude/agents/ux-developer.md` | Corrected `lions-blue`/`lions-blue-dark`/`lions-gold` hex values to match `tailwind.config.ts`; added source-of-truth pointer |
| 2 | `.claude/agents/architect.md` | Added "Migration Numbers Are Tentative in Phase 2" note (closes last open 06-27 carry-forward) |
| 3 | `.claude/agents/qa.md` | Added "Verified Fact vs. Root-Cause Theory" discipline |
| 4 | `.claude/agents/qa.md` | Added "Long-Running Verification — Don't Park Silently" note |
| 5 | `.claude/agents/deployment-engineer.md` | Added matching long-running-verification note |
| 6 | `.claude/agents/api-developer.md` | Added "Scope discipline near financial code" note |
| 7 | `.claude/agents/full-stack-developer.md` | Added matching scope-discipline note |
| 8 | `.claude/agents/tech-lead.md` | Named the 2026-09-09 minutes feature as a concrete specialist-split precedent in the nomination guidance |

## Summary of Proposals (not applied — see full text above)

| # | File | Change | Why proposed, not applied |
|---|------|--------|---------------------------|
| 1 | `.claude/skills/pre-push/SKILL.md` | Add a `pnpm lint` step; give gates a `PASS / FAIL / COULD NOT RUN` outcome | New blocking check on every future push |
| 2 | `.claude/skills/pre-push/SKILL.md` | Add business-vs-personal-data guidance to the PII sweep | Narrows what a security-motivated hard-stop gate blocks on |
| 3 | `.claude/skills/pre-push/SKILL.md` | Advisory review-cadence line in the housekeeping summary | Judgment call on adding process; flagged as genuinely uncertain, not a confident recommendation |

---

## Baseline for Next Review

**Date of this review:** 2026-09-10
**Next agent-instruction review due:** 2026-10-10

**Items to watch:**
- Were the three pre-push proposals acted on (any of the three), and if the lint step was added, did it stay green?
- Does the qa root-cause discipline note actually change qa's write-ups the next time a theory is involved, or does it need sharper wording?
- Any recurrence of a financial-code scope-creep attempt despite the new guardrail note?
- Did the documentation-review / agent-instruction-review merge question get resolved either way, or is this the fifth cycle carrying it forward unresolved?

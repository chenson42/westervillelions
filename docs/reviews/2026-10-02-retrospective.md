# Retrospective — 2026-10-02

**One-line outcome:** The pipeline earned its cost this week on the two things it is for (an architect catching a credential-escalation path nobody had asked about, and a QA live run refuting a Phase 3 safety claim 4 times out of 4), and every collision from running four pipelines on one working tree was survivable (14 incidents, 0 shipped defects) — but the week also shows three process failures the pipeline did not catch itself: (1) none of the 2026-09-25 retrospective's 11 file edits landed (0 of 11, down from 3 of 12), so "write it down" has now demonstrably stopped working as the enforcement mechanism for retro edits; (2) two of this week's four refuted claims were written by Phase 3 (me) in the indicative mood without being measured, and the one fact question that decided a whole feature (which books the treasurer's gift was on) was answered by a Phase 1 default that proved wrong; (3) production-data discipline lives only in user memory and in each agent's good manners — no checked-in file an agent reads says "never write to production", and one `.env.local` line plus a Neon MCP default make production one forgotten argument away.

---

## Scope of This Retrospective

**Period:** 2026-09-26 through 2026-10-02 (7 days after 2026-09-25: the cadence is met for the first time since June; the two gaps before it were 15 and 75 days).
**Material read:** the eight `docs/work-log/2026-10-0*.md` files (every phase section; ~1.27 MB), plus the two in-period earlier logs `2026-09-28-public-form-spam.md` and `2026-09-29-bulk-edit-same-title-events.md` (nine commits sit in the period; ten pipelines), `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, release notes v1.85–v1.88, `git log --since=2026-09-26`, current `CLAUDE.md`, `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`, `docs/decisions.md` / `docs/backlog.md` as they stand today, and the user's memory notes `feedback_no_prod_data_edits.md`, `feedback_proceed_with_recommendations.md`, `project_neon_branches.md`.
**Not available to me:** the orchestrator conversation itself. The two explicit production deletes, the stopped hand-SQL move ("don't mess with production") and the "represent what actually happened" exchange are taken from the task brief and the memory note, not from a transcript; where I describe them I say so.
**Output size for context:** v1.83.0 → v1.88.0 (six releases); 12 decisions (DECISION-104–115); backlog B-73 → B-144 (72 IDs in 7 days; 119 open items); unit tests 2203 → 3294 (+1091); five feature commits edited `CLAUDE.md` (feature documentation), none a process rule.

### Review cadence (as of 2026-10-02)

| Review | Cadence | Last run | Days | Status |
|---|---|---|---|---|
| retrospective | 7d | 2026-09-25 | 7 | on time (this one) |
| test-coverage | 7d | 2026-09-25 | 7 | due today; being written concurrently |
| security | 30d | 2026-09-03 | 29 | **due tomorrow** (see §7 for scope suggestions) |
| code / documentation / agent-instruction / dependencies | 30d | 2026-09-10 | 22 | due 2026-10-10 |

---

## 1. Prior Retro Status — Did the 2026-09-25 Retrospective's 12 Proposed Edits Land?

Checked by grepping `CLAUDE.md`, `.claude/agents/*.md`, `.claude/skills/*/SKILL.md` for each edit's distinctive text.

| # | Edit (grade then) | Landed? | Evidence this week bearing on it | Disposition now |
|---|---|---|---|---|
| 1 | Public-Exposure Exception (MUST) | No | No change widened what a public route serves (09-28 spam work touched public forms' *inputs*). Untested either way. | Keep, SHOULD (§7 S8) |
| 2 | "No silent starts" (MUST) | No | All 10 pipelines have a work-log with a per-phase table (I did not check timestamps against first code). Compliant by practice. | Downgrade to COULD |
| 3 | Mid-flight scope routing (MUST, **5th cycle**) | No | The purpose is being met in practice: every split-pipeline Phase 3 opens "Rulings that differ from Phase 1/2 (read first)" (5 of 5) and every Phase 4 has "Deviations from design"; cross-entity Phase 2 R7 explicitly "pulled in / pushed out" items. | **Replace** with a rule that codifies that practice (§7 M7). Stop re-proposing the old text. |
| 4 | qa.md anonymous-payload check (MUST) | No | Not exercised (no public-data change). | Keep, SHOULD |
| 5 | Name multi-review-overdue state (SHOULD) | No | Cadence is on time now. | **Drop** |
| 6 | Scheduled cadence-audit job (flag) | Undecided | Same. | **Drop** (cadence recovered without it) |
| 7 | analyst Phase 6 states retro recommendation (SHOULD) | No | This retro was triggered by cadence, not by an analyst note. | COULD |
| 8 | Work-log stub regardless of commit framing (SHOULD) | No | One instance: `f5ae00c` (Next 16.3.8 + brace-expansion CVE bump) shipped with no work-log; no application logic changed, so the *rule as proposed* would not have fired. | COULD; add "dependency patches get a 5-line stub" if you want it closed |
| 9 | qa.md no ground-truth-from-dev-DB / no hardcoded dates (SHOULD) | No | The QA sections I read snapshot the DB before and after and use tagged fixtures (`E2E QA Move`, `example.invalid`). Behaviour is good; the text is absent. | COULD |
| 10 | Monitor/until-loop + interrupted-agent stub (SHOULD) | No | No stalled or interrupted agent recorded in these logs. | COULD |
| 11 | Document "Accelerated" variant in CLAUDE.md (COULD) | No | Three Phase 2 skips this week followed an unwritten trigger checklist (§3). | **Promote to SHOULD** (§7 S7) |
| 12 | `isolation: "worktree"` note (COULD) | No | This is theme (3). Fourteen collision incidents. | **Promote to SHOULD, scoped** (§7 M5) |

**Read on this: 0 of 11 file edits landed** (edit 6 is a flag, not an edit). The prior cycle's own text predicted it ("a fourth identical MUST with no application is itself evidence that 'write it down' has stopped working for this specific item") and told us to change the enforcement mechanism rather than the wording. Nobody did, including me: I proposed edits and stopped. During the same seven days five feature commits edited `CLAUDE.md` (feature documentation), so the file was open and the orchestrator was in it; the retro punch list simply had no owner and no checkpoint. That is a structural fault, not a compliance fault. Proposal M1 below attaches a checkpoint to the thing the project already reads at session start (`docs/reviews/log.md`).

---

## 2. Findings, Ranked

### 2.1 HIGH — The retro-edit loop has no closing step (theme: meta; evidence §1)

Covered above. The fix is small: the log line records `musts: applied/proposed`, and the existing Cadence Check at Session Start surfaces any unapplied MUST by name. See M1.

### 2.2 HIGH — Phase 3 (me) wrote two empirical claims as fact, and QA refuted both the same day (theme 1)

| Claim | Where written | Falsified by | Cost |
|---|---|---|---|
| "all 14 of Phase 1's junk rows clear this bar" (DECISION-104) | 2026-09-28 Phase 3 | QA ran the purge dry-run against live production data (read-only, explicitly authorized): **5 of 16** recovered; `work-log/2026-09-28-public-form-spam.md` L1613–1625 (FAIL, loop-back to Phase 3 Revision 2) | One full loop; shipped design is materially better (four-signal score, cooldown moved before content check) |
| "the close-time tie-out would surface it" — the accepted residual on the cross-entity move race (DECISION-112, design X4) | 2026-10-01 Phase 3 | QA live interleaving: orphan Club-row-on-Foundation-session **4 of 4**, `close` returned a clean `200 {status: "closed"}` (`cross-entity-transaction-move.md` L1335–1338) | A code fix (B-105 shape pulled into v1.87.0) and a corrected DECISION |

Both sentences sat in prose with no "believed" or "measured" marker. The X4 case is instructive because the design *did* name live check 2c for exactly this uncertainty ("Expected and recorded, not failed") — QA ran it and recorded 4/4. That is the pattern working: **an accepted residual with a named live check that records the observed rate.** What failed was the unlabelled sentence beside it that told every later reader the backstop existed. Two more tech-lead-originated statements went stale the same day for a related reason (design defaults reversed by the orchestrator after the doc was written): DECISION-115 items 3 and 8 and B-131 (§2.6). Proposal M4.

### 2.3 HIGH — A defaulted *fact* question built a feature that did not serve the requester (themes 1, 5)

`move-or-cancel-transaction.md` L223–226: Phase 1 Open Question 1 asked "Which side was the donation entered on?", adopted the default "Club Administrative Fund", and wrote "If it was entered on the Foundation books, v1 does not cover it." The real answer was the Foundation's books with the cash in the Club's account. Consequences, all documented:

- Phase 2 Correction 2 then declared Foundation-to-Club re-entry "unsafe, withdrawn" — true only for cash in the Foundation's account (Phase 6 L1143 says so), an over-generalisation built on the defaulted premise; B-96 and DECISION-109 inherited the one-sided phrasing.
- v1.86.0 shipped a clean, reviewed feature whose Phase 6 ONE-LINE TAKE is "it is not what resolves the treasurer's own case" (L1134). The case needed v1.87.0 the same day.

This is the user's own memory note colliding with the pipeline: `feedback_proceed_with_recommendations.md` says to adopt recommended defaults but *still ask* "for choices involving real club facts." The analyst agent does not read that memory, and its file has no such split. Proposal M3(a).

### 2.4 HIGH — Production-data discipline is a personal-memory rule plus good manners (theme 4)

What the record shows:

- `feedback_no_prod_data_edits.md` (user memory): on 2026-10-01 the main session inspected a mis-placed donation row and "started lining up a direct cross-entity SQL move"; the user replied "don't mess with production". Two *explicit, specific* production deletes (unsent email-queue rows; stray open reconciliation sessions) earlier that day were fine. The difference is initiative.
- Both explicit deletes were then productised by the pipeline — `discard-reconciliation-session.md` Phase 6 L540: "That is the hand-SQL cleanup, productised" (DECISION-108), and DECISION-107 for the queue. The in-app path *was* the right answer both times.
- **No checked-in file states the rule.** `grep -i "prod\|PROD_DATABASE" .claude/agents/*.md` finds only build/deploy text. A subagent reading `CLAUDE.md` + its own file learns that `PROD_DATABASE_URL` exists (CLAUDE.md "Environment Variables") and nothing about not writing through it.
- **The barrier is a promise.** All eight October work-logs carry a line like "`PROD_DATABASE_URL` is set in `.env.local` but never exported or read; hosts differ" (e.g. `treasurer-permission-baseline.md` L805, `discard-reconciliation-session.md` L461, `email-queue-retention.md` L640). Agents asserting abstention in every log is evidence the hazard is real and being managed by vigilance. CLAUDE.md itself says setting it in `.env.local` "makes production the default target for all of them — including destructive ones."
- `project_neon_branches.md`: `mcp__Neon__run_sql` **without `branchId` hits production**; it also records that an analyst-reported "7 NULL Club rows" figure came from a different branch than the app's.

"Represent what actually happened" (from the brief; I have not seen the exchange): the principle that the books record real events, and that a correction must be something the audit log can show, is exactly why the in-app audited route beat hand SQL. The work-logs already encode its operational form — `bankAccountId` means where the cash actually is (`move-or-cancel` L98), and delete-and-re-enter is right exactly when the re-entered row lands on the account the cash touched (`cross-entity` L42). A hand-SQL move leaves no audit row and a history in which the original entry never existed. Proposals M2 and S4.

### 2.5 MEDIUM — Four pipelines on one tree: 14 collisions, 0 shipped defects, real verification noise (theme 3)

Complete list, with where recorded:

| # | Incident | Source |
|---|---|---|
| C1 | `pnpm lint` red from another pipeline's half-written hooks (`useInsteadAction` called conditionally in `duplicate-payment-advisory.tsx`, `reconciliation-match-picker.tsx`); persisted across a re-run; forced "PASS for B-111 scope, with caveat" | baseline L791–800 |
| C2 | `tsc` red mid-edit, eight failed gate runs attributed to other pipelines: reimbursements page importing a deleted dialog (tsc ×3, build ×2 across Phase 4 and 5), a B-108 test file TS2769 (tsc ×2, build ×1) | email-queue L593, L625–629; baseline L791–793 |
| C3 | Transient unit failure (T32) when another pipeline's new audit action landed mid-run | baseline L765 |
| C4 | Shared scratchpad overwritten by another agent; QA also overwrote its *own* earlier-phase files (`q.sh`, `txn.sql`, `mig1.log`, `dev.log`…) | email-queue L691; baseline L917 |
| C5 | `rm -rf` on a mis-pathed `/private/tmp/claude-501/-Users-cshenso`: the parent-scratch directory of a *different* Claude project (the home-directory one); QA disclosed it could not tell whether another session lost files | baseline L917 |
| C6 | Dev server predating a new schema column returned 500 (`Cannot convert undefined or null to object`); fixed by restart | cross-entity L1220 |
| C7 | The single `:3000` dev server killed/replaced/restarted by at least four agents, one stopping a pre-existing server it had not started; one left running "because another pipeline was using it" | baseline L917; reconcilable L871, L908; email-queue L691 |
| C8 | `pnpm dev` replays `drizzle/migrations/` against the shared dev DB at startup, so one pipeline's *in-flight* migration 0110 would have been applied by another pipeline's server start; reconcilable QA started `next dev` directly to avoid it | reconcilable L871; `package.json` `dev` script |
| C9 | Shared-DB baselines moved under QA (`blocked_non_production` 460 → 462; user/transaction totals), so "left as found" became "left as found apart from the other pipelines' rows" | email-queue L650; reimbursements L865 |
| C10 | Full e2e (serial, ~12 min, one DB) unrunnable concurrently: **4 of 8** pipelines ran no e2e at all, 4 ran scoped specs, none ran the full suite | aged-fund L572; discard L450; email-queue L676; reimbursements L823 |
| C11 | Hot shared files carried other pipelines' uncommitted edits (`schema.ts`, `permissions.ts`, `ledger-audit.ts`, `decisions.md`, `backlog.md`, `release-notes`, `package.json`) → agents deferred filing and used placeholders (`B-next-A…H`, "migration number tentative", "B-129 is claimed by the B-108 work-log"); aged-fund's Phase 3 assigned version 1.84.1 while three other pipelines drafted unversioned | discard L598; baseline L358; aged-fund L394; email-queue L774 |
| C12 | A single working tree forced bundled commits: `15c9c18` = four features, 50 files; `e8c29ea` = two features, 124 files, +14,587 lines. Revert granularity is gone; Phase 6 itself recommended "hunk-level staging, not `git add -A`" | git; discard L598; baseline L1015 |
| C13 | Temporary-user fixtures enqueue real-address "Unlinked User Alert" rows (blocked, never sent) | discard L503–510 |
| C14 | An untracked scratch spec (`e2e/tmp-b108-ux-walk.spec.ts`) sat in the tree during another pipeline's push prep | baseline L1015 (not in the final commits; confirmed) |

**Honest accounting.** No collision produced a shipped defect; each was caught by a re-run and *labelled* ("concurrent pipeline, not this diff") — the QA agents handled it well. The cost was (a) QA time and verdict ambiguity, (b) two bundled commits that cannot be reverted separately, (c) one destructive command on a path the agent could not vouch for (C5), and (d) schema-linked incidents (C6, C8, and migration-number placeholders) that a shared dev DB makes unavoidable. 10-02 (two pipelines) was *not* clean (C1, C2, C3, C8 all occurred), so "cap at two" alone is not the fix.

**Evaluating the options the brief proposed:**

| Option | Fixes | Doesn't fix | Cost | Verdict |
|---|---|---|---|---|
| Worktree per pipeline | C1–C3, C6, C7, C12, C14 | C8, C9, C10 (one shared dev DB!); `.env.local` is untracked so each worktree needs it copied; each needs `pnpm install` and its own `.next`; docs top-insertion (`decisions.md`, `backlog.md`) conflicts on *every* merge | Medium | Right for **schema-touching pipelines** and any time ≥2 are in Phase 4/5; needs a per-pipeline Neon branch to be worth it (see `project_neon_branches.md`; branching is already a documented project skill). Not worth it for read-only phases. |
| Lock on shared docs | C11 | Nothing else | Low, but a lock agents must remember is a prose rule | Replace with single-filer rule (below) |
| Agents never edit `decisions.md`/`backlog.md`; orchestrator/tech-lead files | C11, ID races | Staleness of text drafted early (DECISION-115 draft went stale — §2.6) | Free; already de facto in ≥5 logs | **Adopt**, with `Status: Proposed` until Phase 6 |
| Cap concurrent pipelines | Reduces all | Doesn't remove any | Throughput | Soft cap of 2 past Phase 3 on a shared tree |
| Per-pipeline scratch subdir + destructive-command rule | C4, C5 | — | Free | **Adopt** (MUST) |
| One dev server owned by the orchestrator | C6, C7 | C8 | Free | **Adopt** |

I did not verify whether Next 16 refuses a second `next dev` in the same directory (`node_modules/next/dist/docs` is silent), so per-pipeline dev-server ports without worktrees is untested; a worktree gets its own `.next` regardless.

### 2.6 MEDIUM — Docs went stale inside a day seven times; every one was caught by a person at Phase 6, none by a check (theme 6)

| # | Artifact | Written | Falsified | Caught by | State today |
|---|---|---|---|---|---|
| 1 | DECISION-112 "close-time tie-out would surface it" (+ the same clause in B-105) | 10-01 Phase 3 | 10-01 QA F1 | Phase 6 analyst (who also corrected the orchestrator's pointer: "the wrong sentence is in DECISION-112, not DECISION-113", L1476) | fixed (`decisions.md` L346) |
| 2 | DECISION-115 items 3 & 8 + Impact ("inherit to every `admin.users` holder"; "existing admins bounced, accept with a release-note line") | 10-02 Phase 2/3 | 10-02, orchestrator's F1 decision before Phase 4 (any-of for one release) | Phase 6 analyst, pre-push condition | fixed with `[Corrected 2026-10-02]` notes |
| 3 | B-131 / B-111 / B-122 / B-134 entries | 10-02 | 10-02 | Phase 6 | fixed (B-131 amended; B-134 reads "shipped v1.88.0") |
| 4 | **DECISION-109 item 5**: "`ledger.manage` is bound to `admin` only and the treasurer is one of the two admins" | 10-01 | 10-02, by DECISION-115 (explicitly "Amends: DECISION-109 item 5") | architect noted it; nobody back-annotated | **STILL STALE** — `decisions.md` L485; DECISION-109's Status line cites DECISION-112 but not 115 |
| 5 | CLAUDE.md "Ledger corrections … the Foundation-deposit case is NOT a move" | v1.86 (10-01 am) | v1.87 (10-01 pm) | api-developer flagged "ship-time (tech-lead): rewrite" (cross-entity L884) | fixed in `95f977e` |
| 6 | Release-notes drafts: omitted the Foundation-deposit paragraph (move-or-cancel) and the F1 reconciliation change (cross-entity) | 10-01 | 10-01 Phase 6 | Phase 6 | fixed |
| 7 | DECISION-109 / B-96 "Foundation-to-Club re-entry would put a Club row on an account the cash never touched" (true only if cash is in the Foundation's account) | 10-01 | 10-01 | Phase 6 (L1143) | B-96 closed won't-do 10-02 |

Items 1, 2, 3, 5, 6 were found and fixed *within the day*, which is the process working — by analyst effort. Item 4 shows the gap: **DECISION-115 declares an amendment and DECISION-109 never learns of it.** A 25-line script (Appendix A) walks `Amends: DECISION-N` / "amends DECISION-N" edges and checks the target's block mentions the amender: it finds **4 of 8 edges with no back-reference today**, including 115 → 109 (live) and two older ones (109 → 36, 99 → 36). That is the cheapest check that would have caught the one stale item that is still live.

### 2.7 MEDIUM — Specialist splits held; the two "half shipped broken" windows were both disclosed, not discovered (theme 2)

Six split pipelines this week (events, move-or-cancel, reimbursements, cross-entity db→api→ux, reconcilable, baseline db→api×2); three full-stack (discard, email-queue, spam). Handoff contract loop-backs from Phase 5 to Phase 4: **zero**. QA-found defects traced to a client/server mismatch: **zero**. The two windows:

1. **Reimbursement UI sending `approve` after the server removed it.** The api-developer wrote it into the handoff: "Existing UI still compiles because it only calls the HTTP routes; it will send `approve` and omit the stale tokens until ux-developer lands, so **do not deploy the server half alone**" (`reimbursements-no-board-approval.md` L752). It surfaced to other pipelines as three `tsc` failures when the UI half was mid-edit (C2).
2. **Recent-corrections reader rendering every non-moved row as "Deleted."** The api-developer widened `LedgerCorrectionRow.kind` to `"moved" | "deleted" | "corrected"` and noted the UI's `row.kind === "moved" ? "Moved" : "Deleted"` "must be switched to an exhaustive `Record<kind, …>` + `never` check before anything calls the correct route"; "Nothing in the app calls the route yet" (`reimbursement-reconcilable.md` L741). The ux-developer did exactly that (L798, T44).

**Why the contract held where it held:** the ledger feature set carries its API vocabulary in client-safe modules (`ledger-correction.ts`, "FROZEN … import, never redeclare", cross-entity L1154) so `tsc` is the contract; in cross-entity the api-developer's retyping of `MovePreview` broke three UI files and the gate *forced* minimal compile fixes (L1182). **Where it was prose only** (`approve` as a string literal in a `fetch` body; a ternary-else over a widened union) the compiler could not help and the contract held only because the api-developer read the consumers and said so. Both would silently misbehave if the halves had been deployed apart; the project's own rules (no push without approval, `/pre-push`) are what prevented that. Verdict on the 2026-05-27 question: **keep the split for new-API-plus-UI features; add a contract-carrier requirement** (M6). The full-stack lane also worked (discard, email-queue clean; spam's FAIL was a Phase 3 measurement error, not a lane error).

### 2.8 LOW — The e2e cold-start sign-in race recurred in the path the 09-10 fix does not cover (theme 7)

Occurrences: `2026-10-01-aged-public-fund-fifo.md` L562 ("cold dev server … `MissingCSRF` race … warm retry succeeded") and `treasurer-permission-baseline.md` L851 ("first run's admin persona timed out on cold compile of the sign-in path"). Both were **scripted QA walks after a dev-server (re)start**. `e2e/global-setup.ts` (added 2026-09-10) warms `WARM_PATHS` including `/api/auth/csrf`, but it runs only under `pnpm test:e2e`. QA restarts the server on every schema change (C6) and then drives a throwaway Playwright script that never passes through `globalSetup`. The 09-10 file header warns about "the worst kind of flake: it teaches you to shrug and re-run". Both were shrugged and re-run, correctly this time, but the cause is known and cheap to close (S5).

### 2.9 LOW — Watch items

- **Work-log size.** The eight logs total ~1.27 MB (largest 270 KB). Phase 5 and 6 agents "read Phases 1–5 in full" each time. The "Rulings that differ from Phase 1/2 (read first)" section at the head of each Phase 3 is what keeps this tractable; do not lose it (M7).
- **Backlog inflation.** B-73 → B-144 in one week (72 IDs); 119 open. Most are Phase 6 "B-next" follow-ups (e.g. 8 from `move-or-cancel` alone). No triage step exists; the 30-day code review is the only reader. Suggest the 30-day documentation review count open items by age.
- **Phase 6 verdict mix:** 2 SHIP IT, 8 SHIP WITH NOTES (at least five carried a *pre-push documentation condition*: move-or-cancel, cross-entity, baseline, discard, email-queue). The notes machinery works; the doc conditions should be extractable (S2).
- **Durable-Claim Exception is being consulted** in practice: reimbursements architect ruling 5 ("NOT triggered … `sendBulkMemberEmailForDurableClaim()` must not be used"), reconcilable ruling 9, email-queue Phase 2 skip rationale, move-or-cancel Phase 6. The 09-25 MUST that did land is working.
- **`docs/reviews/log.md` has eight entries stranded above its own `## Entries` heading** (lines 34–43 when I wrote this: the 2026-10-01 `treasurer-self-sufficiency` entry, the five 2026-09-10 retrospective/code/documentation/agent-instruction/dependencies entries, 2026-09-09 test-coverage, 2026-07-28 dependencies), sitting between the Format section and the "If three retrospectives…" sentence. They are the *most recent* entries for four of the 30-day reviews, so the Cadence Check reads the wrong region if it stops at `## Entries`. Not fixed here (a concurrent test-coverage entry was being added to the same file). **Fixed 2026-10-02** (see §8): all eight moved under `## Entries` in date order.
- **Full-suite e2e at push.** `v1.85.md` says "the full test suite, build and e2e run were repeated" for the dependency patch; I could not tell from the record whether `/pre-push` Step 7 ran the *full* suite for v1.86–v1.88 (QA ran scoped specs only). **Answered 2026-10-02 (orchestrator):** the full serial e2e suite did run before each push: **v1.86.0 201 passed, v1.87.0 220 passed, v1.88.0 220 passed.** The record in the work-logs shows only the scoped specs because the push-time run was recorded at the push, not in a pipeline's Phase 5. Not a finding; the gap was in where the run is written down, not in whether it happened. (C10 above is correct as stated: no *pipeline's QA* ran the full suite, because it cannot run concurrently; the orchestrator's pre-push run is where it happens.)

---

## 3. Pipeline Efficacy — Which Phases Caught Real Defects, Which Were Skipped

Counts are my reading of the logs ("real" = would have shipped wrong, or a claim later readers would have relied on). They are not a measurement of effort.

| Phase | Real catches this week | Examples (file refs in §2) | Misses / introduced error |
|---|---|---|---|
| 1 analyst | ~4 | Discard: `ON DELETE SET NULL` on `reconciled_session_id` makes the `status='open'` pin in the DELETE load-bearing (discard L46, L121–129); cross-entity: issuer must be recorded once a receipt leaves its row (Gap 1 — real need, but the *mechanism* was overstated: `letter_text` is already a snapshot and sent receipts are refused regeneration; architect Correction 1); brief corrections (5 in cross-entity Phase 1) | Q1 defaulted wrong (§2.3) |
| 2 architect | ≥10 | **M1** Email Queue = reset-token viewer, would have given any `email_queue.manage` holder admin via the public forgot-password form (baseline L261–272) — a path Phase 1's own rule ("never bind `admin.users` to treasurer") had not seen; **reconcile-toggle hole**: `POST …/reconcile` gated only `ledger.record`, writes `reconciledSessionId: null`, so any recorder could unlock a cleared row and make the new `ledger.manage` tier "decorative" (move-or-cancel L264; fixed as a v1.86 precondition); reimbursements R-1 (self-pay check silently passes when the session has no `memberId`), R-4 (amount race), R-5/R-7 (two pre-existing TOCTOU races, member edit vs pay, reject vs pay); cross-entity: `parseVersioned()` accepts only `v:1` so v2 audit rows would render with every field null, and a backfill that stamps from the *current* entity would restamp on every deploy replay | Correction 2 (move-or-cancel) over-generalised from the defaulted premise |
| 3 tech-lead | ~5 | X1 commit-on-return trap in `db.transaction`; X4 corrected the race window from "sub-millisecond" to "the move transaction's duration"; baseline test B1 is impossible for `treasurer` alone without an exemption; welcome email has no temp password (architect assumed one); F1 stale-JWT rollout hazard | **Three false or stale claims** (DECISION-104, DECISION-112, DECISION-115 defaults) — §2.2 |
| 4 implementers | 2 disclosed windows + 1 bug | ux-developer found and fixed Radix `AlertDialog.Description` `<p>`-nesting during the events click-through (09-29 L1060, L1098); api-developer disclosed both half-ship windows (§2.7) | — |
| 5 qa | 2 high, 1 low | **F1** race 4/4 + refuted backstop; **09-28 FAIL** (5/16, plus a purge-script crash from ES-import hoisting vs `dotenv.config()`); F-QA-1 (two spellings of one gate set → new parity test, mutation-checked). Method worth naming: *mutation testing* of guards a mocked `db` cannot prove (reimbursements R-5/R-7 guards, baseline 8 of 8 mutations caught) | 6 of 10 pipelines: no defect. Brief errors corrected by QA: 201 vs 200, `/admin` vs `/access-pending` (baseline L851) |
| 6 analyst | 1 high, ≥6 doc | Treasurer's actual case unserved by v1.86; located the wrong sentence in the right DECISION; four pre-push doc conditions on baseline | — |

**QA's two high catches share one property: both required real state** (a real Postgres interleaving; real production rows) that every earlier phase and every unit test mocked. That is the strongest argument in this week's data for Phase 5's live-DB checks and against letting a PASS rest on mocked suites for any money-adjacent invariant.

**Skips.** Phase 2 skipped ×3 (aged-fund, discard, email-queue retention); Phase 3 abbreviated ×1 (email-queue, "brief design"); Phase 5 e2e not run ×4 ("no spec touches this surface"); every skip is in the per-phase table with a rationale — **no silent skips**. **Cost of any skip this week: none observed** (all three Phase 2 skips ended SHIP IT / SHIP WITH NOTES with no defect traced to the missing review; discard's analyst had already caught the FK trap). The skips were *safe because* each carried an explicit trigger checklist ("no new directory, dependency, primitive, `FEATURES` key, schema change or email; not a durable-claim path") — an unwritten checklist that CLAUDE.md does not contain (09-25 Edit 11). n = 3 is not evidence the skip is always safe; it is evidence the checklist is what makes it safe.

---

## 4. Answering the Brief's Questions Directly

**Theme 1.** Phases 2 and 5 caught the severe defects; Phase 3 introduced the stale/false claims; Phase 1's default policy lost a cycle. No skip cost anything. See §3.

**Theme 2.** Splits held; the only two broken-half windows were disclosed by the api-developer. The compiler is the contract where vocabulary lives in a client-safe module and is *not* the contract for HTTP action strings or ternary-else over a widened union. §2.7, M6.

**Theme 3.** Fourteen incidents, 0 shipped defects; worktrees are right for schema-touching pipelines (with a Neon branch each) but not a cure-all; free rules cover C4, C5, C7, C11. §2.5, M5.

**Theme 4.** Move the rule out of memory and into CLAUDE.md Workflow Rule 10 and every DB-touching agent file; consider taking `PROD_DATABASE_URL` out of `.env.local`. §2.4, M2, S4.

**Theme 5.** Yes: state it. The analyst has all tools (including Neon MCP) and in every case declined to query production; that was the right behaviour and is currently unwritten. It worked: the reconcilable Phase 1 "Design for Both Verify Outcomes" table (L118–127) let Phase 1 advance, and the production result later *confirmed* the audit's NEW-1 (two null-account rows) and the orchestrator pre-flight (reimbursements L1007) removed three open questions. What needs fixing is the *form*: results landed in four different places (end-of-log pre-flight, Phase 3 "Evidence gathered", Phase 5 "post-deploy", prose). M3(b) defines one block.

**Theme 6.** Seven same-day staleness events; one still live; one script catches it. §2.6, M4(b), S2, Appendix A.

**Theme 7.** Hit twice, in the scripted-walk path that bypasses `globalSetup`. §2.8, S5.

---

## 5. Concrete Proposed Edits (Graded — Not Applied)

*Status as written:* nothing below had been applied when this retrospective was drafted. **Status as of 2026-10-02 (same session): all seven MUSTs applied as quoted; see §8 for what landed where, and what was declined or left open.** Each MUST names the file, the anchor and the exact text.

### MUST

**M1 — CLAUDE.md → Periodic Reviews → "Logging Outcomes" and "Cadence Check at Session Start".** Close the retro loop (§1). Append to *Logging Outcomes*:

> A retrospective is not closed until each MUST it proposes has been applied or explicitly declined by the user, in the same session. Its log line ends with `musts: <applied>/<proposed>`. If the user is not present to approve edits, the retrospective logs `musts: 0/<n> (awaiting approval)` and the next session treats that as an overdue review.

and append to *Cadence Check at Session Start*:

> Also read the most recent `retrospective` line. If its `musts:` figure is not `n/n`, list the open MUSTs by name before any feature work, the same way an overdue review is surfaced. This is what lets a retrospective's edits land: the checkpoint sits in a file every session already reads.

**M2 — CLAUDE.md → Workflow Rules (new rule 10); one-line pointer in `database-admin.md`, `api-developer.md`, `qa.md`, `analyst.md`, `deployment-engineer.md`.** Production data (§2.4). Proposed rule 10:

> 10. **Production data is read-only to agents.** A subagent never writes to the production database by any route: `PROD_DATABASE_URL`, the Neon MCP (`run_sql`, `run_sql_transaction`, `prepare_database_migration`, `create_branch`/`reset_*`/`restore_*` on the production branch), or a script run with `--apply` while `PROD_DATABASE_URL` is set. The orchestrator writes to production only when the user names that specific write in that turn — a general "fix it" or an earlier instruction does not count — and records the exact statement, the row counts before and after, and the user's words in the work-log. **Reads** are allowed to the orchestrator only: counts, booleans and role/config names; never copy personal data into the repo or a work-log; always pass `branchId` explicitly (the Neon MCP default branch *is* production). When a production data problem surfaces, report what the read shows, name the in-app audited path, or propose building it — do not propose hand SQL. A correction to the club's books goes through the app's audited routes so the audit log records that a correction happened; hand SQL leaves a history in which the original entry never existed.

Pointer for each agent file: "Production data: see CLAUDE.md Workflow Rule 10. You do not read or write production; ask the orchestrator (analyst: use a Verify-First block)." Rationale for putting it in CLAUDE.md: the rule currently lives only in `feedback_no_prod_data_edits.md`, a personal memory file a subagent may not receive.

**M3 — `.claude/agents/analyst.md` → Phase 1.** Two additions (§2.3, theme 5).

(a) After "Open questions": 

> **Classify every open question.** *Preference* (naming, copy, defaults of taste): state your recommended default and proceed. *Fact about the requester's real situation* (which fund or account a record sits in, who holds a role today, whether a defect has already occurred in real data, whose cash landed where): if the answer decides which feature gets built, it is **never defaulted**. Put it first, mark it `BLOCKING FACT`, and have the orchestrator ask the user in one line before Phase 2. If it truly cannot be answered, write a "Design for both outcomes" table (see `docs/work-log/2026-10-02-reimbursement-reconcilable.md`), not a single adopted default. (2026-10-01: the one question that decided `move-or-cancel` — "which books was the gift on?" — was defaulted, the default was wrong, and v1.86.0 did not serve the case it was built for.)

(b) New subsection "Production facts: write the query, don't run it":

> You do not query the production database. When a verdict depends on a production fact, add a **Verify-First block** to your Phase 1 body: the exact read-only `SELECT` (counts or booleans only, no personal columns), why the answer matters, and your recommendation under each outcome. The orchestrator runs it with an explicit `branchId` and pastes the counts into the work-log under a heading **"Production facts (orchestrator, YYYY-MM-DD)"** placed directly under your Phase 1 section. Never state a production fact you did not see in that block; if it has not arrived, advance as READY WITH NOTES with both branches.

**M4 — `.claude/agents/tech-lead.md` (my own file), "Technical Design" section.** Three rules (§2.2, §2.6).

> **(a) Unmeasured claims carry a label.** Any sentence in a design, DECISION or backlog item of the form "X would surface / catch / recover / clear / prevent Y" must cite the code path or the measurement that shows it, or be written "believed, unmeasured" — in the DECISION text itself, not only the design. For every *accepted residual* on a money, permission or credential invariant, name a Phase 5 live check whose job is to record the observed rate (precedent: cross-entity check 2c, which produced the 4/4).
>
> **(b) DECISIONs are filed `Status: Proposed` at Phase 3 and promoted to `Resolved` at Phase 6**, after re-reading each factual sentence against QA's "Established" list. A DECISION that amends an earlier one adds `(item k amended by DECISION-N)` to the earlier one's Status line in the same edit.
>
> **(c) The design's release-notes draft carries no version number** (precedent: `aged-fund` assigned 1.84.1 while three other pipelines drafted unversioned). Version assignment belongs to `/release-notes` at ship time.

**M5 — CLAUDE.md → Development Pipeline → new subsection "Concurrent Pipelines (shared working tree)"** (§2.5; supersedes 09-25 Edit 12):

> When more than one pipeline is in flight against one working tree:
> 1. **Scratch space.** Every agent works in `<scratchpad>/<pipeline-slug>/` from its first command and never writes to the scratchpad root. **`rm -rf` only a path you created in the same command** (from `mktemp -d` or your own `<pipeline-slug>/` subdirectory, verified non-empty and absolute) — never a directory you "just made by mistake" and cannot vouch for.
> 2. **One dev server, owned by the orchestrator.** Agents do not kill, replace or restart the `:3000` server; ask the orchestrator, which announces the restart in the affected work-logs. A schema change in any pipeline requires a restart before another pipeline's live checks. `pnpm dev` replays `drizzle/migrations/` at start: a pipeline's in-flight migration is applied by *every* pipeline's server start, so migration files are not added to the tree until the owner's Phase 4 schema step is complete.
> 3. **Gate failures in files you did not touch are "concurrent, not this diff."** Record file, line and owning pipeline; re-run until green or classify; never edit another pipeline's file to turn a gate green. A PASS states the tree state it was measured on.
> 4. **Filing.** Architects and analysts draft; only tech-lead edits `docs/decisions.md` (this narrows `tech-lead.md`'s "architect logs architectural ones" — in every log read, the architect already drafted rather than filed), only the orchestrator or tech-lead edits `docs/backlog.md`, `package.json` and `docs/release-notes/`. Other agents write "Proposed DECISION/backlog text" blocks. IDs are reserved by the orchestrator in a `Reserved IDs:` line in the work-log header at pipeline start; migration numbers are re-derived (`ls drizzle/migrations | sort | tail -3`) at Phase 4 start.
> 5. **Worktrees.** A pipeline that adds a migration, and any second pipeline in Phase 4/5 at the same time, runs its implementers and qa in an `isolation: "worktree"` with its own Neon branch for the dev database and its own `.env.local` copy. Read-only phases (1, 2, 3, 6) share the main tree. A soft cap of two pipelines past Phase 3 on one tree.
> 6. **Push.** One `/pre-push` on the combined tree after every in-flight pipeline reaches Phase 6; the orchestrator, not an individual QA, owns the push gates. Commits are split by pipeline with hunk-level staging where files interleave.

**M6 — `api-developer.md` and `.claude/agents/tech-lead.md` design template, "API Contract"** (§2.7). Contract carriers:

> Every route contract names its **carrier**: the client-safe module that exports the request/response types *and* any action or `kind` enum the UI branches on (precedent: `ledger-correction.ts`). The UI imports from the carrier, so removing or widening a member breaks `tsc`. When you remove or widen a member, your pass is not done until `tsc` is green *including every client consumer*; minimal compile-fix edits to UI files are yours (behaviour and copy remain ux-developer's). List in your handoff every consumer you grepped (`grep -rn "\.kind ===\|action:" src/components`) and convert any `x === "a" ? … : …` over a widened union to an exhaustive `switch` with a `never` check yourself — a ternary-else compiles silently.

**M7 — CLAUDE.md → Phase 4, replacing the never-landed "mid-flight scope routing" text** (§1 row 3):

> **Scope is routed at the phase where it appears.** Every Phase 3 design opens with a "Rulings that differ from Phase 1/2 (read first)" section; every Phase 4 handoff has "Deviations from the design". Anything an implementer or user adds beyond the design is listed there and routed by size: under ~30 lines, no schema and no new API → absorbed with a note; a new schema, API or page → back to Phase 3; a new flow or permission → back to Phase 1. Scope added by an agent unprompted (as in the 2026-09-10 compiler-findings case) is rejected unless it meets the same test.

*Decision for the user:* retire the old verbatim text for good (this proposal says why) or reinstate it — but stop carrying it forward unchanged. **Resolved 2026-10-02: retired for good.** (The old text had never been added to `CLAUDE.md`, so "replacing" it meant adding M7's text and not carrying the old wording forward again.)

### SHOULD

**S1 — `qa.md`, "Phase 5 Verification Body".** Concurrent-tree protocol (derived from M5.3):

> On a shared tree, run each gate until green or classify each failure as *this diff* or *concurrent* (file, line, owning pipeline); a `PASS` for your scope must state which failures were concurrent and the tree state; never fix another pipeline's file. Before any live check, restart the dev server only through the orchestrator (M5.2). Snapshot the DB before and after, and report drift attributable to other pipelines separately ("left as found, apart from…").

**S2 — `.claude/skills/pre-push/SKILL.md`, new "Docs Owed" step** (§2.6):

> List, from every work-log touched by this push, each line matching `pre-push condition|ship-time|bookkeeping owed|owed at push|\[ \]` and require each be resolved or restated. Run `node scripts/check-decision-xrefs.mjs` (Appendix A) and fail on any `Amends: DECISION-N` whose target does not mention N. Fail if any DECISION cited in a Phase 6 section still has `Status: Proposed`.

**S3 — `analyst.md` Phase 6.** Add: "Re-read every factual sentence of any DECISION the feature filed against QA's *Established* list; a refuted sentence is a pre-push condition, not a note." (Today this happens by diligence — §2.6 items 1, 2, 6.)

**S4 — Production exposure (user decision, not an agent edit).** Move `PROD_DATABASE_URL` out of `.env.local` into an unloaded `.env.prod` (scripts read it only via an explicit `--env-file`/`PROD=1`); keep the `*** TARGET: PRODUCTION ***` banner. Rationale: all eight October work-logs assert "never read"; CLAUDE.md already documents that putting it in `.env.local` makes production every script's default. Also record in `project_neon_branches.md`-equivalent repo text (not only memory) that the Neon MCP default branch is production.

**S5 — e2e cold start** (§2.8). `qa.md`: "After any dev-server start or restart, `curl` `/api/auth/csrf`, `/api/auth/session`, `/signin` and `/admin` once before the first scripted sign-in — `e2e/global-setup.ts` only warms under `pnpm test:e2e`." Code (not agent-file) follow-up: extract `WARM_PATHS` from `e2e/global-setup.ts` into `e2e/helpers/warm.ts`, export `warmDevServer()`, and have `signInAsAdmin()` retry once when it lands back on `/signin?callbackUrl=`.

**S6 — `.claude/skills/new-feature/SKILL.md` and `tech-lead.md`.** Reserve IDs and record the Phase 2 trigger checklist in the work-log header (feeds M5.4, S7).

**S7 — CLAUDE.md → Development Pipeline.** Document the *Accelerated* variant and its Phase 2 skip checklist (09-25 Edit 11, promoted):

> A Phase 2 skip is permitted only when **all** hold: no new directory, dependency or shared primitive; no `FEATURES` key; no schema change; no email; not a durable-claim path; not a change to what a public route serves; no change to a reconciled/locked invariant. The analyst names which hold; the orchestrator confirms; the work-log's per-phase table records the skip and the checklist result. If any one fails, run Phase 2. (2026-10-01: three skips against this unwritten list, no defect traced to any.)

**S8 — CLAUDE.md → Bug-Fix Variant.** Re-propose the 09-25 Public-Exposure Exception verbatim (still unapplied; not yet tested by evidence).

**S9 — `api-developer.md` / `database-admin.md`.** "Accepted residual → named live check": when your design or implementation accepts a race or window, say so in the handoff so QA can name it (precedent X4/2c).

### COULD

- **C1 — `analyst.md`:** "Orchestrator briefs are inputs, not facts" — verify any pointer (DECISION number, line, status code, which agent said what) before relying on it; this week agents corrected the brief at least five times (cross-entity Phase 1 ×5; baseline QA 201→200, `/admin`→`/access-pending`; reconcilable QA own-request buttons; Phase 6 DECISION-113→112).
- **C2 — CLAUDE.md Key Features.** The five paragraphs added this week to a now 776-line file duplicate DECISIONs. 30-day documentation review: consider moving rule detail to `docs/decisions.md` and leaving a one-line pointer.
- **C3 — dependency patches get a 5-line work-log stub** (`f5ae00c` had none).
- **C4 — 09-25 Edits 2, 7, 8, 9, 10** (downgraded above).
- **C5 — `.sql.wip` convention** for in-flight migrations so another pipeline's `pnpm dev` cannot apply them (alternative to M5.2's "not added to the tree" if that proves awkward for database-admin).

### Dropped

09-25 Edits 5 and 6 (cadence is on time; no scheduled job needed). The old text of Edit 3 (replaced by M7).

---

## 6. Items to Watch at Next Retrospective (due 2026-10-09)

- Did M1 land, and does the next log line carry `musts: n/n`? If this retro's MUSTs also sit unapplied, the problem is not wording or mechanism but ownership, and it needs a named owner (user decision).
- Any `rm -rf`, dev-server kill, or `pnpm dev`-applied foreign migration in a work-log after M5?
- Any production write by an agent, or a work-log that states a production fact outside a "Production facts" block?
- Did a `BLOCKING FACT` question get asked rather than defaulted?
- Same-day staleness count; `scripts/check-decision-xrefs.mjs` result (DECISION-109 item 5 must be annotated first).
- First real email-queue purge, on/after 2026-10-13 (treasurer reminder set for 2026-10-14); B-131 / B-136 sequencing (30 days from 2026-10-02 is 2026-11-01).
- Post-deploy check for B-108: `SELECT count(*) FROM ledger_transactions WHERE status='posted' AND bank_account_id IS NULL` returns 0 after the treasurer repairs the two October 1 rows (orchestrator runs it, M2/M3(b) form).

## 7. Suggested Scope Additions for the 30-Day Reviews Due Soon

- **Security (due 2026-10-03):** the Email Queue "viewer of persisted bodies holds every credential those bodies carry" checklist line the architect asked for (baseline L270), B-132 (inventory of other readers of `email_queue.html`, event-announcement and acknowledgment bodies); the transitional `EMAIL_QUEUE_FEATURES` any-of (B-136); the `rm -rf`/scratch hygiene incident; and a LOW PII-adjacent note: production Neon endpoint-host fragments (`ep-rough-smoke-…`) and the Neon project id appear in older work-logs in this public repo (`2026-08-08-meeting-minutes.md`, `2026-08-08-acknowledgment-donor-link.md`, `2026-07-28-fy2026-foundation-budget-seed.md`; this week's `email-queue-retention.md` truncates it). Infra identifiers, not credentials — the reviewer decides.
- **Documentation:** DECISION-109 item 5 (stale); cross-reference script; CLAUDE.md length (C2); the stranded entries in `docs/reviews/log.md` (§2.9).
- **Agent & instruction:** M2–M6 land in the five agent files; confirm none of them duplicates CLAUDE.md text (each should point, not copy).

---

## 8. Disposition — Decision Log (2026-10-02)

Recorded in the same session as the retrospective, per M1's own rule. Source of the decisions: the orchestrator's brief on 2026-10-02, relayed from the user's choices; this section records them, it does not make them.

### Applied: MUSTs 7 of 7 (`musts: 7/7 applied`)

| MUST | Landed in | Notes |
|---|---|---|
| M1 | `CLAUDE.md` → Periodic Reviews → *Cadence Check at Session Start* and *Logging Outcomes* | Text as quoted. Today's retrospective line in `docs/reviews/log.md` now ends `musts: 7/7 applied`. |
| M2 | `CLAUDE.md` → Workflow Rules → new rule 10; pointer paragraph in `.claude/agents/analyst.md`, `api-developer.md`, `database-admin.md`, `qa.md`, `deployment-engineer.md` | Rule text as quoted. The analyst pointer adds "use a Verify-First block" per M2's analyst variant. Orchestrator ruling: **the production-reads-are-orchestrator-only rule stands.** |
| M3 | `.claude/agents/analyst.md` → Phase 1 (after *Your Phase 1 Body*) | (a) "Classify every open question" and (b) "Production facts: write the query, don't run it", as quoted. |
| M4 | `.claude/agents/tech-lead.md` → after the design template | Rules (a), (b), (c) as quoted, under the heading "Design-writing rules". |
| M5 | `CLAUDE.md` → Development Pipeline → new subsection "Concurrent Pipelines (shared working tree)" | Six items as quoted, plus a one-paragraph *Why* citing §2.5. It is a `###` subsection of an existing section, so the `**Sections:**` index at the top of `CLAUDE.md` needed no change. |
| M6 | `.claude/agents/api-developer.md` (new "Contract carriers" paragraph), `.claude/agents/tech-lead.md` design template (a "Carrier" line under *API Contract*) | Also added the same one-line "Carrier" bullet to the `## API Contract` section of `docs/work-log/_template.md`, since that is the template Phase 3 sections are copied from. |
| M7 | `CLAUDE.md` → Phase 4, before *Gate* | Text as quoted. Old "mid-flight scope routing" wording retired for good (user decision, see M7 above). |

Two small additions beyond the quoted text, both needed to keep the files from contradicting each other: `.claude/agents/tech-lead.md` Technical Decisions now ends with a pointer that, when more than one pipeline is in flight, architects and analysts draft and tech-lead files (M5.4 says it narrows that file's "architect logs architectural ones" wording); and the `_template.md` carrier line above.

### Declined

- **S4 (move `PROD_DATABASE_URL` out of `.env.local`): declined for now, user's choice.** `PROD_DATABASE_URL` stays in `.env.local`. The exposure described in §2.4 therefore stands: every script defaults to production and the only barrier is the `*** TARGET: PRODUCTION ***` banner plus M2 / Workflow Rule 10. Revisit at the next retrospective if a work-log again has to assert "never read". The second half of S4 (record in repo text that the Neon MCP default branch is production) is covered by rule 10's "always pass `branchId` explicitly (the Neon MCP default branch *is* production)".

### Not applied in this pass (carried to the next retrospective, due 2026-10-09)

SHOULD S1, S2, S3, S5 (the `qa.md` text; the code half is filed as B-152), S6, S7, S8, S9 and COULD C1–C5 were outside this pass's scope and remain unapplied. They are not MUSTs, so `musts:` is unaffected, but 09-25's lesson applies: an item that sits unapplied across a second retro should be dropped or promoted, not re-listed.

### Filed (docs/backlog.md; from the 2026-10-02 test-coverage review)

| ID | Item | Tier |
|---|---|---|
| B-145 | P1: member RSVP and signup route tests + one member e2e | Soon (high) |
| B-146 | P2: public forms + junk-guard wiring tests, reset/register, forgot-reset-sign-in e2e | Soon (high) |
| B-147 | P3: `permissions-server.ts` resolver under test + JWT-callback parity (flagged 2026-05-18 and 2026-06-24) | Soon (high) |
| B-148 | P4: aged-fund loader SQL coverage | Later |
| B-149 | P5: reimbursement lifecycle e2e including Mark Paid under deny-by-default email | Later |
| B-150 | P6: discard-session and close/match account-mismatch guards in e2e | Later |
| B-151 | P7: `provisionUserForMember` existing-user branches | Later |
| B-152 | One sign-in helper with bounded, logged `MissingCSRF` retry replacing nine spec-local copies (+ S5 code half: `warmDevServer()`) | Soon |
| B-153 | `user_roles` missing `UNIQUE (user_id, role_id)` (+ two leaked dev fixtures) | Later |
| B-154 | UTC-dated e2e fixtures (latent, 2027-06-30) | Later |
| B-74 | Amended, not new: the `treasurer` role can now reach the retry route (DECISION-115), and the retention purge narrows the window to about six months | Now (existing) |

Not filed from the test-coverage review: P8 (FK `SET NULL` pin and first-purge check), P9, P10, P11's fixture sweep beyond B-153, P12; they stay in `2026-10-02-test-coverage.md`.

### Housekeeping done

- `docs/reviews/log.md`: the eight entries stranded above `## Entries` (2026-10-01 treasurer-self-sufficiency, five from 2026-09-10, 2026-09-09 test-coverage, 2026-07-28 dependencies) moved into the newest-first list in date order; the Cadence Check now reads them. Today's retrospective line says `musts: 7/7 applied`.
- Items still open from this retrospective, none blocking: DECISION-109 item 5 is still stale and needs a back-annotation naming DECISION-115 (§2.6; `docs/decisions.md` is outside this pass's edit scope); Appendix A's cross-reference script is still a prototype, not committed.

---

## Appendix A — Cross-reference check (prototype; run today)

```js
// scripts/check-decision-xrefs.mjs (prototype — not committed)
import fs from "fs";
const parts = fs.readFileSync("docs/decisions.md", "utf8")
  .split(/^## (?=DECISION-\d+)/m).slice(1);
const blocks = {};
for (const p of parts) { const m = p.match(/^DECISION-(\d+)/); if (m) blocks[+m[1]] = p; }
let edges = 0; const missing = [];
for (const [n, b] of Object.entries(blocks)) {
  const found = new Set();
  for (const m of b.split("\n")[0].matchAll(/amends? DECISION-(\d+)/gi)) found.add(+m[1]);
  const am = b.match(/\*\*Amends:\*\*[^\n]*/);
  if (am) for (const m of am[0].matchAll(/DECISION-(\d+)/g)) found.add(+m[1]);
  for (const t of found) {
    if (t === +n || !blocks[t]) continue; edges++;
    if (!new RegExp(`DECISION-${n}\\b`).test(blocks[t])) missing.push(`${n} -> ${t}`);
  }
}
console.log(`amend edges: ${edges}; targets lacking a back-reference: ${missing.length}`);
console.log(missing.join("\n"));
```

Output on 2026-10-02: `amend edges: 8; targets lacking a back-reference: 4` — `14 -> 13`, `99 -> 36`, `109 -> 36`, `115 -> 109`. It only sees amendments declared in a heading or an `**Amends:**` line, so it under-counts; it is a floor.

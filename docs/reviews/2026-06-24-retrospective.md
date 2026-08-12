# Retrospective — 2026-06-24

**One-line outcome:** Donate-fix was clean and fast; deployment unblocked only after three unnecessary force-pushes to main caused by over-theorizing an external-system failure without ground truth — produces one new must-fix guardrail; 2025-05-27 MUST edits both landed, SHOULD edits did not, no new features shipped since the last retro.

---

## 1. Prior Retro Status — Did the 5 Proposed Edits Land?

### Edit 1 — Feature-gate audit in qa.md (MUST) — APPLIED

`qa.md` now has an explicit **Feature-Gate Audit** section with a required table (route, `auth()` present, `hasFeature()` present, correct key) and a hard statement that a missing gate is a FAIL even if all tests pass. The 2026-05-27 commit `00339f3` applied this.

### Edit 2 — CVE audit in /pre-push (MUST) — APPLIED

`pre-push/SKILL.md` now has a Step 8 (Dependency CVE Audit) that runs `pnpm audit --prod --audit-level=high`, requires zero high-severity findings, surfaces the fix path, and requires explicit user acknowledgment to override. Same commit `00339f3`.

### Edit 3 — Full-stack-developer as default in CLAUDE.md (SHOULD) — NOT APPLIED

The Phase 4 implementer-selection table in CLAUDE.md still presents four options as equally weighted with no note that `full-stack-developer` is the default. The text proposed in the prior retro ("When in doubt, use `full-stack-developer` — the specialist split is reserved for work where the schema or the route layer is large enough to implement independently") was not added.

### Edit 4 — Deployment-engineer is reactive in CLAUDE.md (SHOULD) — NOT APPLIED

The Agent Roster table still lists deployment-engineer as "Pre-deploy | Production build verification, env vars, build failures." The correction — marking the role as reactive and noting that `/pre-push` fills the pre-deploy slot — was not applied.

### Edit 5 — Merge doc and agent-instruction reviews (COULD) — NOT APPLIED

The two reviews remain separate rows in the CLAUDE.md Periodic Reviews table. This is a cosmetic / process consolidation; no urgency.

**Summary:** Both MUST edits are live. Three SHOULD/COULD edits remain pending and are carried forward here.

---

## 2. Session in Review — The Donate Fix

### What went well

The functional fix was clean and followed the Bug-Fix Variant path correctly. Both root causes were identified quickly:

1. CSP `frame-src` never whitelisted `https://www.zeffy.com` — one line in `next.config.ts` plus a `Permissions-Policy` header.
2. The Zeffy `og:image` scrape silently broke when Zeffy's Cloudflare began returning 403 to server-side fetches — scrape removed, local fallback added.

Three e2e tests were added in `e2e/donate.spec.ts` covering both regressions plus the CSP header assertion. The Zeffy/CSP gotcha was added to `CLAUDE.md` (commit `d42c34a`). The CLAUDE.md update also correctly replaced all Givebutter references with Zeffy across the file — the prior docs had drifted from the actual platform in use. Version bumped to 1.18.6.

### Correct use of Bug-Fix Variant

There is no work-log entry for this session; the fix was done inline without one. The fix was genuinely small and tightly contained — no schema changes, no new permissions, two files changed functionally — so the absence of a work-log is within the spirit of the Bug-Fix Variant. However, a minimal work-log stub (even one paragraph capturing "root cause, fix shape, no phase-2 skip needed") would make the next retrospective's review easier. See Proposed Edits.

---

## 3. The Central Failure — Unnecessary Force-Pushes to Main

### What happened

After shipping v1.18.6 cleanly to git, Vercel blocked the deployment. Diagnosing the blockage required three rounds of force-pushing `main`:

1. **Wrong theory 1:** Blamed the `Co-Authored-By: Claude` commit trailer. Amended the commit to remove it and force-pushed. Disproven: trailer-free commits with the same author were still blocked.
2. **Wrong theory 2:** Blamed the commit author's personal email address. Re-authored all commits to a club-domain address instead and force-pushed. Made it *worse*: that address is not a verified GitHub email, so Vercel could not match it to any GitHub account at all.
3. **Reversion:** Reverted authorship back to the original personal address and force-pushed again.

The actual root cause had nothing to do with the commits: a duplicate Vercel account (`chenson42`) had acquired the same GitHub login as the project-owning Hobby account (`chenson-4144`), causing Vercel's commit-to-account attribution to land on a non-member account. The fix was entirely on the Vercel dashboard — moving the GitHub connection back to `chenson-4144`. Zero git changes were ever needed.

The user pushed back correctly multiple times:
- "Not sure how that could be / why it would make a difference"
- "I don't see anything that changed with our commits"

They were right each time. The assistant over-theorized based on plausible-sounding hypotheses and acted (force-pushed) before having ground truth from the Vercel dashboard.

### Root cause of the root cause

The key error was acting on git history before obtaining evidence from the system that was actually reporting the failure. The commits had not changed. The deploy infrastructure had changed (Vercel account state). When the same input (same author, same file content) suddenly produces a different result from an external system, the correct first move is to inspect that system's state — not to mutate the input and hope the result changes.

### What ground truth looks like, concretely

For a Vercel deploy failure: deploy-detail screenshots or the Vercel activity log showing which account is attributing the commit and what error the deploy surface is returning. Without that evidence, no git mutations should be made.

### Impact

Force-pushes to `main` are destructive. In this case:
- History was rewritten three times on the production branch.
- The commit trailer (`Co-Authored-By`) is a harmless convention that provides attribution — it was removed unnecessarily.
- The author email was changed to an unverified address and then reverted — this wasted time and made the diagnosis harder, not easier.

No code was lost because the content stayed constant, but the principle is: force-push changes history, and any collaborator (or automation) holding a ref to the old tip is now diverged. On a project with a single active developer this is recoverable; it is still wrong.

---

## 4. What Is Working

- **CVE gate in /pre-push is earning its keep.** v1.18.3 through v1.18.5 closed all 14 high CVEs identified in the 2026-05-27 reviews (xlsx → exceljs, Next.js + drizzle-orm bumps, minimatch override). The audit step was added to pre-push on 2026-05-27 and triggered on the very next push cycle. The mechanism worked exactly as designed.
- **Feature-gate audit in qa.md.** Although no new features shipped this cycle to exercise it, the text is correct and explicit.
- **Zeffy gotcha captured in CLAUDE.md.** Both the `frame-src` requirement and the "Zeffy 403s server-side fetches, don't scrape" note are now in CLAUDE.md Gotchas and in the Zeffy integration section. Future sessions will see it before touching the donate page.
- **e2e donate.spec.ts.** Three tests guard against the exact regressions that broke production. One of them (CSP `frame-src` header assertion) is the kind of infrastructure test that is easy to forget — it is now in the suite.

---

## 5. Pre-Existing Process Drag — Failing E2E Specs

`cancel-occurrence.spec.ts` and `write-in-signups.spec.ts` remain in the e2e suite with known-failing tests tied to specific event IDs in the local/test database. These were present before this cycle and are not new. They matter to the retrospective because:

- Every `/pre-push` run surfaces them as failures. The current pre-push skill says "do not proceed if any e2e test fails" — which means either (a) the user skips e2e in the pre-push flow or (b) the skill output is treated as advisory on these known failures.
- Either path erodes the gate's credibility. A pre-push gate that is routinely bypassed for "known failures" is not a gate.

The correct resolution is one of: (a) fix the underlying test isolation (replace hardcoded event IDs with seeded or dynamically created events), or (b) annotate these as `test.skip` with an explicit ticket reference until the isolation work is scheduled. Leaving them silently failing is the worst option.

---

## 6. Observation — No New Features, No New Work-Logs Since May 22

The last work-log entry is `2026-05-22-event-edit-orphans-rsvps.md`, which has never advanced past Phase 1 (all phases Pending). No new features have entered the pipeline since then. The session activity since the last retro has been entirely:
- 30-day periodic reviews (code, security, docs, agent-instruction, dependencies)
- CVE and security remediation (v1.18.2–v1.18.5)
- Bug fix (v1.18.6)

This is not a concern in itself — remediation and infrastructure work is real work. It is noted as a baseline for the next retrospective.

---

## 7. Concrete Edits

### Edit 1 — Add a guardrail against mutating git to diagnose external-system failures (MUST)

**File:** `CLAUDE.md` → Workflow Rules section  
**What to add:** A new rule:

> **Do not force-push `main` to diagnose an external-system (Vercel, CI, GitHub Actions) failure.** When a deploy or check fails for commits that have not changed, suspect the external system's state, not the commit. Get ground truth (dashboard screenshots, deploy logs, error details from the failing service) before mutating history. `git commit --amend` and `git push --force` on `main` are only warranted when the problem is actually in the commit content.

**Why:** Three force-pushes to a production branch to fix a Vercel account misconfiguration that had nothing to do with the commits. The user's pushback was correct each time. The rule makes the correct behavior explicit.

---

### Edit 2 — Add a "get ground truth before acting" principle to deployment-engineer.md (MUST)

**File:** `.claude/agents/deployment-engineer.md`  
**What to add:** In the diagnostic section (or as a leading principle if there isn't one):

> When Vercel or CI blocks a deployment and the commits have not changed from a previously-working state, the failure is almost certainly in the deploy infrastructure's configuration — not in the code. Before proposing any git mutations (amend, rebase, force-push), obtain evidence from the failing system: a deploy-detail screenshot, the Vercel activity log, the CI run output. Known failure modes that are not git problems: duplicate Vercel accounts holding the same GitHub login (fix: Vercel dashboard → GitHub integration → re-link to the correct account), expired OIDC tokens, revoked deploy keys, quota limits.

**Why:** The deployment-engineer agent owns Vercel diagnostics. Codifying "get ground truth before acting" in the agent file makes it actionable for the agent that will be invoked for this class of problem.

---

### Edit 3 — Document the Vercel duplicate-account failure mode in CLAUDE.md (SHOULD)

**File:** `CLAUDE.md` → Gotchas section  
**What to add:**

> **Vercel deploy blocked after a clean push:** If Vercel starts blocking deploys from commits that are structurally identical to previously-accepted commits, the likely cause is Vercel account configuration (duplicate accounts, GitHub integration re-linked to the wrong account), not a problem with the commit content. Fix is entirely on the Vercel dashboard — never force-push `main` to diagnose this. The 2026-06-24 session is the reference case.

**Why:** This failure mode is non-obvious, costly (three force-pushes), and now documented in the retrospective. A one-line gotcha prevents the next session from repeating the same diagnosis error.

---

### Edit 4 — Full-stack-developer as default (carry-forward from 2026-05-27, SHOULD)

**File:** `CLAUDE.md` → Development Pipeline → Phase 4 → Implementer selection table  
**What to add** (after the table):

> When in doubt, use `full-stack-developer`. The specialist split (database-admin, api-developer, ux-developer) is reserved for work where the schema layer or the route layer is large enough to implement independently. In practice, full-stack-developer handles the large majority of Phase 4 work on this project.

**Status:** Carried forward from Edit 3 of the 2026-05-27 retro. Still not applied.

---

### Edit 5 — Deployment-engineer is reactive (carry-forward from 2026-05-27, SHOULD)

**File:** `CLAUDE.md` → Agent Roster table  
**What to change:** Replace `Pre-deploy | Production build verification, env vars, build failures` with `Reactive | Build failures, env-var changes, Vercel diagnostics — not a mandatory pipeline phase. /pre-push covers the pre-deploy checklist.`

**Status:** Carried forward from Edit 4 of the 2026-05-27 retro. Still not applied.

---

### Edit 6 — Address the pre-existing failing e2e specs (SHOULD)

**File:** `e2e/cancel-occurrence.spec.ts`, `e2e/write-in-signups.spec.ts`  
**What to do:** Either annotate the known-failing tests with `test.skip("known flaky: hardcoded event ID needs test isolation work, see <issue>")` or schedule the test isolation fix as a tracked work-log entry. Do not leave them silently failing while the pre-push gate says "do not proceed if any e2e test fails."

---

### Edit 7 — Minimal work-log stub for bug fixes (COULD)

**File:** `CLAUDE.md` → Bug-Fix Variant section  
**What to add** (or add to the bug-fix variant description):

> Even for trivial fixes, create a minimal work-log stub at `docs/work-log/YYYY-MM-DD-<slug>.md` documenting: root cause, fix shape, which phases were explicitly skipped and why. This costs 5 minutes and makes the next retrospective's review tractable. The slug and file need not be elaborate — a 10-line stub is better than nothing.

**Why:** The donate-fix session had no work-log. Reconstructing it for this retrospective required reading the commit diff and release notes. A minimal stub at the time of the fix would have been faster.

---

## Proposed Edits Summary

| # | File | Severity | Change |
|---|------|----------|--------|
| 1 | `CLAUDE.md` → Workflow Rules | MUST | Guardrail: no force-push to main to diagnose external-system failures |
| 2 | `.claude/agents/deployment-engineer.md` | MUST | Get ground truth before acting; known Vercel failure modes list |
| 3 | `CLAUDE.md` → Gotchas | SHOULD | Vercel duplicate-account failure mode documented |
| 4 | `CLAUDE.md` → Phase 4 table | SHOULD | Note full-stack-developer as default (carry-forward) |
| 5 | `CLAUDE.md` → Agent Roster | SHOULD | Deployment-engineer is reactive (carry-forward) |
| 6 | `e2e/cancel-occurrence.spec.ts`, `write-in-signups.spec.ts` | SHOULD | Skip or fix known-failing tests |
| 7 | `CLAUDE.md` → Bug-Fix Variant | COULD | Require minimal work-log stub even for trivial fixes |

---

## Baseline for Next Retrospective

**Date of this retrospective:** 2026-06-24  
**Next retrospective due:** 2026-07-01  

**Items to watch:**
- Were the two MUST edits (CLAUDE.md guardrail + deployment-engineer.md) applied?
- Were the three carry-forward SHOULD edits (4, 5 from 2026-05-27 and 3 from this retro) applied?
- Were the failing e2e specs annotated or scheduled?
- Did `event-edit-orphans-rsvps` (stalled at Phase 1 pending since 2026-05-22) advance?
- Did any feature enter the pipeline?

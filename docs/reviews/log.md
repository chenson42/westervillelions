# Review Log

The source of truth for periodic-review history. Claude reads this at session start to check whether any review is overdue against its cadence (see `CLAUDE.md` → Periodic Reviews).

## Format

Newest first. One line per review:

```
YYYY-MM-DD | <type> | <one-line outcome>
```

Where `<type>` is one of:

- `test-coverage` (cadence: 7 days)
- `retrospective` (cadence: 7 days)
- `code` (cadence: 30 days)
- `documentation` (cadence: 30 days)
- `security` (cadence: 30 days)
- `agent-instruction` (cadence: 30 days)
- `dependencies` (cadence: 30 days)

For substantial reviews that produce significant findings, also write `docs/reviews/YYYY-MM-DD-<type>.md` with the details and link it from the log entry like:

```
2026-05-23 | security | 2 medium findings, 3 low; see 2026-05-23-security.md
```

For no-op reviews (a cycle genuinely produced no actionable findings), use:

```
2026-05-23 | retrospective | nothing material
```

If three retrospectives in a row produce nothing, the cadence itself is suspect — surface that to the user.

## Entries

<!-- newest entries go here, above the older ones -->
2026-06-27 | agent-instruction | 4 medium + 2 low findings; 2 new MUSTs (api/full-stack missing test-deliverable checklist, architect lists xlsx not exceljs); 3 SHOULD carry-forwards now at 2 cycles; pipeline healthy, specialist split confirmed real; see 2026-06-27-agent-instruction.md
2026-06-27 | documentation | 0 high, 2 medium (Project Structure + Key Features missing ledger/dues), 4 low; decisions 001–026 contiguous; release-notes chain v1.18–v1.25 intact; package.json 1.25.0 matches; see 2026-06-27-documentation.md
2026-06-26 | dependencies | prod audit clean (0 high/critical; 3 moderate, 1 low, all transitive); @vercel/blob vetted OK; next-themes dead dep; xlsx still in devDeps (scripts only); 3 overrides recommended; see 2026-06-26-dependencies.md
2026-06-26 | code | 0 high, 3 medium, 5 low; MEDIUM-1 = get990Prep uses opening-balance-only for assets estimate (990 form may differ from overview); MEDIUM-2 = inc3 guardrail flags duplicated in getComplianceOverview vs guardrails(); MEDIUM-3 = canView vestigial in impact page "all" path; see 2026-06-26-code.md
2026-06-25 | test-coverage | Ledger inc4 Phase 5: 258 unit tests PASS; csv-safe.ts 100% (12 csvCellSafe cases); CSV injection escaping + transfer-exclusion + posted-only filter verified via dev-server curl; both new surfaces gate-audited; PASS
2026-06-25 | test-coverage | Ledger inc2 Phase 5: 219 unit tests PASS (2 new regression tests); ledger.ts 100% stmts; events.ts 94.73%; receipt-magic-bytes+LocalReceiptStorage fully covered; all 10 new API routes gate-audited; PASS
2026-06-24 | test-coverage | Ledger inc1 Phase 5: 191 unit tests PASS (11 new determine990 tests added); ledger.ts 100% stmts/funcs; events.ts 94.73%; FY boundary + transfer atomicity verified via DB; all 5 API routes gate-audited; no invariant violations
2026-06-24 | test-coverage | 115 unit tests PASS; 18/22 e2e PASS; 2 failing specs are date-anchored rot in cancel-occurrence.spec.ts (CANCEL_DATE/SIGNUP_BLOCKED_DATE now past); donate.spec.ts adequate; events.ts 94.73% stmts; members.ts 0% (pre-existing); fix: advance hardcoded dates to Aug 2026; see 2026-06-24-test-coverage.md
2026-06-24 | retrospective | donate-fix clean; deploy unblocked only after 3 unnecessary force-pushes to main — over-theorized an external Vercel account misconfiguration without ground truth; 2 new must-fix edits + 5 carry-forwards; see 2026-06-24-retrospective.md
2026-05-27 | retrospective | first ever: PII-export cluster (code + security both flagged same routes), CVE cluster (Next.js + drizzle SQLi), specialist-split is a paper fiction (full-stack-developer owns 9/10 Phase 4); 5 proposed edits (2 must, 2 should, 1 could); see 2026-05-27-retrospective.md
2026-05-27 | dependencies | 9 patch / 14 minor / 3 major outdated; 14 high CVEs in production (Next 16.1→16.2 fixes 8; drizzle-orm SQLi fix); xlsx unfixable, replace with exceljs; see 2026-05-27-dependencies.md
2026-06-24 | security | all 4 prior-highs closed; 0 critical, 0 high, 3 medium, 3 low; new medium = SSRF in zeffy-meta URL check, cleanupExpiredTokens eq() bug, page-level auth gap (8 admin pages, carry-forward); see 2026-06-24-security.md
2026-05-27 | security | 0 critical, 4 high, 3 medium, 3 low; high = Next CVEs, drizzle SQLi, xlsx unfixable, member/newsletter exports lack feature gate (bulk PII to any authed user); see 2026-05-27-security.md
2026-05-27 | code | first ever: 0 high, 2 medium, 4 low (MEDIUM-2 retracted: src/proxy.ts is the Next.js 16 middleware convention, not dead code — architect applied pre-v16 framework knowledge); remaining medium = page-level defense-in-depth gap on 9 admin pages, two export endpoints lack feature gate (PII); see 2026-05-27-code.md
2026-05-27 | documentation | first ever: 0 high, 2 medium, 5 low; medium = 6 env vars missing from CLAUDE.md (Google Groups + fallback aliases), dashboard routing structure wrong; see 2026-05-27-documentation.md
2026-05-27 | agent-instruction | first ever: 4 low + 2 informational; nothing broken, sharpening edits only — specialist agents never spawned, deployment-engineer absorbed by /pre-push, add-permission skill references non-existent CLAUDE.md inventory; see 2026-05-27-agent-instruction.md
2026-05-20 | test-coverage | ICS feature: 93 unit tests (94.02% stmts / 85.03% branch on events.ts); 32 new ICS tests including wall-clock regression guard; build and typecheck pass; members.ts at 0% (pre-existing, e2e-covered); no new gaps introduced
2026-05-18 | test-coverage | follow-up: 5 priority gaps closed; Vitest 59 (+20), Playwright 9 (+6); all gates pass; see 2026-05-18-test-coverage.md
2026-05-18 | test-coverage | baseline established: 39 unit tests in events.ts (92.76% stmts, 83.33% branch); 3 e2e smoke tests pass; 0 of 9 cancel-occurrence flows and 0 of 8 wall-clock display flows have automated coverage; 5 priority gaps identified; see 2026-05-18-test-coverage.md

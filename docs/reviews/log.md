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
2026-05-20 | test-coverage | ICS feature: 93 unit tests (94.02% stmts / 85.03% branch on events.ts); 32 new ICS tests including wall-clock regression guard; build and typecheck pass; members.ts at 0% (pre-existing, e2e-covered); no new gaps introduced
2026-05-18 | test-coverage | follow-up: 5 priority gaps closed; Vitest 59 (+20), Playwright 9 (+6); all gates pass; see 2026-05-18-test-coverage.md
2026-05-18 | test-coverage | baseline established: 39 unit tests in events.ts (92.76% stmts, 83.33% branch); 3 e2e smoke tests pass; 0 of 9 cancel-occurrence flows and 0 of 8 wall-clock display flows have automated coverage; 5 priority gaps identified; see 2026-05-18-test-coverage.md

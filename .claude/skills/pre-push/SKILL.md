---
name: pre-push
description: Run pre-push verification — typecheck, unit tests, build, e2e tests, schema/migration check, release notes, and a quick housekeeping sweep — before pushing to main
---

# Pre-Push Checks

When the user invokes `/pre-push`, run every verification step required before pushing to `main`. This skill never pushes — it only reports readiness.

If `vitest.config.ts` / `playwright.config.ts` aren't present yet, **skip the corresponding test step with a note** rather than failing — they will be wired in over time. Don't pretend a missing runner passed.

## Step 1: Snapshot the Current State

Run, in parallel:

- `git status`
- `git log --oneline -10`
- `git branch --show-current`

Confirm:

- What branch we're on.
- What's staged and unstaged.
- What commits will be in the push.

**If there are uncommitted changes:** STOP. Ask the user whether to commit them first or abort.

## Step 2: Sync with `main` (if on a feature branch)

```bash
git fetch origin main
git log HEAD..origin/main --oneline
```

If `main` has new commits, ask the user whether to merge before continuing. Don't merge unilaterally — branch sync is an explicit user choice.

## Step 3: Type Check

```bash
pnpm exec tsc --noEmit
```

If it fails:

- Show the error output.
- Identify the failing file(s) and error type.
- Offer to fix the issues.

**Do not proceed if typecheck fails.**

## Step 4: Lint

```bash
pnpm lint
```

**Distinguish two different outcomes — they are not the same event.**

| Exit | Meaning | What to do |
|------|---------|-----------|
| `0` | Clean | Continue. |
| `1` | ESLint ran and **found problems** | Report the errors. Do not proceed with errors; warnings are advisory. |
| `2` (or a stack trace / "Oops! Something went wrong!") | ESLint **could not run at all** | **HARD STOP.** This is not a lint failure, it is a *missing gate*. Report it as "lint DID NOT RUN", never as "lint failed". |

That distinction is the whole point of this step. On 2026-09-09 a CVE-motivated
`minimatch` override fed an ESM-only build into `@eslint/eslintrc` and ESLint crashed
outright with exit 2. Because a crashed gate is indistinguishable from a failing one at a
glance, 24 real errors accumulated unseen — including three genuine user-facing defects
(unformatted dates carrying a latent UTC-offset bug, a permissions screen with no save
feedback and no double-submit guard, and a chunked upload that re-sent an entire 25MB
file on retry). A gate that cannot run is worse than a gate that fails, because it looks
like silence rather than a problem.

Apply the same reading to every other step here: if a check *could not execute*, say so
explicitly rather than folding it into PASS/FAIL.

**Do not proceed if ESLint reports errors, or if ESLint could not run.**

## Step 5: Unit Tests (Vitest)

```bash
pnpm test
```

If `vitest.config.ts` is missing or the `test` script isn't in `package.json`, skip with a note ("unit-test runner not yet installed") and continue. Otherwise:

- A single red test is a red build. Show the failing test name and `file:line`.
- Offer to either fix the underlying defect or hand back to the implementer.

**Do not proceed if any unit test fails** (when the runner is installed).

## Step 6: Production Build

```bash
pnpm build:only
```

`next build` does its own type pass and catches things `tsc --noEmit` alone won't (the Next.js plugin, route inference, server/client boundary errors). If the build fails:

- Show the failing route or module.
- Offer to fix.

**Do not proceed if the build fails.**

After the build, eyeball the route list it prints — make sure no expected route silently dropped out.

## Step 7: End-to-End Tests (Playwright)

```bash
# In one terminal:
pnpm dev
# In another:
pnpm test:e2e
```

If `playwright.config.ts` or the `test:e2e` script is missing, skip with a note and continue. Playwright does **not** spawn the dev server, so confirm `pnpm dev` is up against `.env.local` before running.

- A single red e2e test is a red build. Show the failing flow and the screenshot/trace path Playwright writes.
- Flaky tests that pass on retry should still be flagged — flakiness is a bug.

**Do not proceed if any e2e test fails** (when the runner is installed).

## Step 8: Schema and Migration Check

`src/lib/db/schema.ts` is the source of truth. Migrations under `drizzle/migrations/` re-run on every deploy, so **every statement must be idempotent**.

1. Check whether `schema.ts` has changed since `main`:
   ```bash
   git diff main -- src/lib/db/schema.ts
   ```
2. If yes, check whether a corresponding SQL migration is committed under `drizzle/migrations/`:
   ```bash
   git status drizzle/migrations/ | head
   git diff main -- drizzle/migrations/ | head -80
   ```
3. If the schema changed but no migration was added, ask the user whether they intended to:
   - Add an idempotent SQL migration file (`drizzle/migrations/NNNN_*.sql`) — required so the deploy can re-apply it.
   - Rely only on `drizzle-kit push` (the production build runs it). Acceptable for additive column changes; risky for anything else.
4. If a new migration exists, scan it for non-idempotent statements:
   ```bash
   grep -nE "^\s*(CREATE TABLE |ALTER TABLE [^ ]+ ADD COLUMN |INSERT INTO |CREATE INDEX )" drizzle/migrations/<new>.sql | grep -vE "IF NOT EXISTS|ON CONFLICT|WHERE NOT EXISTS"
   ```
   Any hit is a likely re-run failure waiting to happen. Fix before pushing.

## Step 9: Dependency CVE Audit

Runs `pnpm audit` against the production tree. The 2026-05-27 dependencies review surfaced 14 high CVEs (8 in `next`, 1 SQL-injection in `drizzle-orm`, plus transitives) that had piled up since the previous monthly sweep. This step is the gate that catches the next pile-up before it hits production.

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 20 > /dev/null 2>&1 || true
pnpm audit --prod --audit-level=high
```

`--prod` skips devDependencies (test runners, type stubs, build tools). `--audit-level=high` exits 0 unless something is high or critical.

**Do not proceed if `pnpm audit --prod --audit-level=high` exits non-zero.**

- Report the affected package(s), severity, advisory ID(s), and the recommended fix path (direct bump vs. transitive).
- Offer to bump the affected package(s) inline. A patch or minor bump to a CVE-patched version, with the test suite and build re-run, is the normal escape hatch.
- If a CVE has no fix available (e.g., `xlsx`'s unpatched advisories — the SheetJS maintainers moved patched releases off npm), the user must explicitly acknowledge the unfixed CVE to override the gate. Log the override in the work-log or release-notes entry, not just in the skill output.

Moderate or low CVEs are advisory. Mention any new ones the user hasn't seen, but they don't block the push.

## Step 10: Personal Data Sweep

**This repository is public. A personal address, phone number, or home address must never be pushed.**

```bash
git grep -InE "[a-zA-Z0-9._%+-]+@(gmail|hotmail|msn|att|yahoo|sbcglobal|aol|insight|live|outlook|comcast|icloud|me)\\.[a-z.]+" -- . \
  | grep -v "example\\.\(com\|invalid\|test\)"
git grep -InE "\\b[0-9]{3}-[0-9]{3}-[0-9]{4}\\b|\\([0-9]{3}\\) ?[0-9]{3}-[0-9]{4}" -- .
git grep -InE "[0-9]{3,5} [A-Z][a-zA-Z]+ (Circle|Drive|Street|Road|Avenue|Ave|Lane|Court|Blvd|Way)\\b" -- .
```

**Any hit is a hard stop until you have triaged it.** Do not push on an untriaged hit. See
CLAUDE.md → *No Personal Data in the Repository* for what is banned and what is allowed.
Club-domain addresses (`board@`, `club@`, `info@`, `treasurer@`,
`noreply@westervillelions.org`) are fine and will not match the pattern above. Officer names
are fine; their contact details are not.

**The phone and address patterns have known, legitimate hits — triage, don't rubber-stamp.**
The club publishes a public directory of eyeglass drop-off locations (businesses, churches,
libraries) with their street addresses and phone numbers, seeded in
`drizzle/migrations/0034_glasses_dropoff_refresh.sql` and rendered on the public `/programs`
page. Those are *organisations*, published by the club on its own website — not personal data,
and not a violation. `555-` numbers in tests and `e.g.` placeholders in form components are
likewise fine.

The question to ask of every hit is **"does this tie a PERSON to contact details?"** — not
"does this look like a phone number". A business at a commercial address is allowed; a member's
home address is never allowed, even if it is formatted identically.

This distinction matters more than it looks. A sweep that reliably produces the same ~17
false positives trains whoever runs it to skim past the output, which is exactly how a real
hit gets waved through. If you find yourself scrolling past known-good hits, tighten the
pattern or add an explicit allowlist rather than building the habit of ignoring it.

Also confirm nothing env-shaped is staged — `.env*` is gitignored, but on 2026-08-12 a
`.env.local.bak-<timestamp>` slipped past that rule and was pushed with every production
credential in it:

```bash
git ls-files | grep -E "\\.env" | grep -v "^\\.env\\.example$"
```

Anything other than `.env.example` is a hard stop.

## Step 11: Release Notes and Version Bump

**Required before every push to `main`.**

1. Read `package.json` to see the current version.
2. Read the most recent `docs/release-notes/vX.Y.md` to see the latest entry.
3. Run `git log origin/main..HEAD --oneline` to list the commits being pushed.
4. Invoke `/release-notes` to write or extend the entry and bump `package.json`.
5. Commit the release-notes change so it goes out with the push.

**Documentation-only changes don't need a version bump.** Bug fixes get a PATCH bump. New features get a MINOR. Breaking changes get a MAJOR.

## Step 12: Housekeeping Sweep

Treat these as advisory warnings, not hard blockers (unless the user decides otherwise):

- **New environment variables?** Documented in `CLAUDE.md`?
- **New tables or columns?** Defined in `src/lib/db/schema.ts` *and* the matching idempotent migration?
- **New routes or actions?** Auth + feature gate present on every protected entry?
- **No stray debug logs?**
  ```bash
  grep -r "console.log" src/ --include="*.ts" --include="*.tsx" | grep -v "// " | head -10
  ```
- **No native browser dialogs?**
  ```bash
  grep -rE "alert\(|confirm\(|prompt\(" src/ --include="*.ts" --include="*.tsx"
  ```
  Any hit should use `<ConfirmDialog>` from `@/components/ui/confirm-dialog` or a shadcn `Dialog`.
- **No env files staged?**
  ```bash
  git diff --name-only | grep -E "\.env"
  ```

## Step 13: Summary

Report results:

- Type check: PASS / FAIL
- Lint: PASS / FAIL (errors) / **DID NOT RUN** (ESLint crashed — a missing gate, not a failing one)
- Unit tests: PASS / FAIL / SKIPPED (runner not installed)
- Production build: PASS / FAIL
- E2E tests: PASS / FAIL / SKIPPED (runner not installed)
- Schema and migrations: in sync and idempotent / pending (with details)
- Dependency CVE audit: PASS / FAIL (advisory IDs if any)
- Personal data sweep: clean / HITS (list them)
- Release notes + version: updated / missing
- Housekeeping warnings: list them
- **Ready to push? yes / no**
- If no: list each item that must be resolved first

**Never report a gate that could not execute as a pass, and never fold it into a
generic FAIL.** "DID NOT RUN" is its own outcome and must be said out loud. A check
that silently stops checking is the failure mode this whole skill exists to prevent —
see Step 4.

**Do not push.** The user pushes manually.

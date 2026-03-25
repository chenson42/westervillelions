---
name: pre-push
description: Run pre-push checks including production build verification before pushing to main
---

# Pre-Push Checks

When the user invokes `/pre-push`, run all verification steps required before pushing code to main.

## Step 1: Check Current State

Run `git status` and `git log --oneline -5` to confirm:
- What branch we're on
- What changes are staged/unstaged
- Recent commits that will be pushed

If there are uncommitted changes, **STOP**. Ask the user whether to commit them first or abort.

## Step 2: Merge Main into Branch (if on a feature branch)

1. Fetch latest: `git fetch origin main`
2. Check for new commits: `git log HEAD..origin/main --oneline`
3. If new commits exist, ask the user whether to merge before testing

## Step 3: Run Production Build

```bash
source ~/.nvm/nvm.sh && nvm use 20 && pnpm build:only
```

This runs `next build` without database changes. If the build fails:
- Show the error output
- Identify the failing file(s) and error type
- Offer to fix the issues

**Do NOT proceed if the build fails.**

## Step 4: Check for Pending Migrations

1. Check `git diff main` for any new or modified `.sql` files in `/drizzle/migrations/`
2. If new migrations exist, ask the user if they've been run locally
3. If not run, offer to run them:
   ```bash
   export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate
   ```

## Step 5: Documentation & Housekeeping

Check the following (treat as advisory warnings, not hard blockers unless user decides otherwise):

- [ ] **New environment variables?** — Are they documented in `CLAUDE.md` and `.env.example` (if it exists)?
- [ ] **New database tables?** — Are they defined in `src/lib/db/schema.ts`?
- [ ] **New API routes?** — Are auth checks present on protected endpoints?
- [ ] **No console.log left in code?** — Run a quick grep
- [ ] **No `.env.local` or credentials in git diff?** — Check `git diff --name-only`

Quick checks:
```bash
# Check for debug logs
grep -r "console.log" src/ --include="*.ts" --include="*.tsx" | grep -v "// " | head -10

# Check for accidental env file staging
git diff --name-only | grep -E "\.env"
```

## Step 6: Summary

Report results:
- Build status (pass/fail)
- Migration status (up to date / needs attention)
- Any warnings found
- Ready to push? (yes/no)

**IMPORTANT**: Do NOT push to remote. Only report readiness. The user will push manually.

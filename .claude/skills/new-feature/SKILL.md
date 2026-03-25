---
name: new-feature
description: Plan and scaffold a new feature with requirements doc and task entry before any implementation begins
argument-hint: "[feature-name]"
---

# New Feature Scaffolding

When the user invokes `/new-feature`, gather information and create planning artifacts before any code is written. The feature name may be provided as `$ARGUMENTS`.

## Step 1: Gather Information

Ask the user:

1. **Feature name** (if not provided)
2. **Area** — Where does it live? Options: `public-site`, `member-portal`, `admin`, `api`, `integrations`
3. **Value/purpose** — Why does this feature matter? What problem does it solve? (Required)
4. **Brief description** — What does it do from the user's perspective?
5. **Authentication** — Who can use it? Public? All logged-in members? Admins only?
6. **Does it need a new permission?** — If admin or role-gated, should it use the permission system?
7. **Estimated complexity** — Simple (< 1 day), Medium (1-3 days), Complex (1+ week)?

## Step 2: Recommend a Workflow

Based on complexity, recommend an SDLC workflow from `CLAUDE.md`:

- **Simple** → Fast Track (implement directly)
- **Medium** → Standard Workflow (tech-lead design → implement → test)
- **Complex** → Full Workflow (tech-lead → db-admin → api-developer → ux-developer → verify)

## Step 3: Create a Requirements Doc (for Medium/Complex)

Create `/docs/features/<feature-name>.md`:

```markdown
# <Feature Name>

**Date:** <today's date>
**Status:** Planning
**Area:** <public-site | member-portal | admin | api | integrations>

## Value
<Why this feature matters — the problem it solves or the opportunity it captures>

## Description
<What the feature does from a user's perspective>

## Users
<Who can access this: public / all members / admin only / specific permissions>

## Permissions
<New permission needed? Which roles should have it?>

## Functional Requirements
- [ ] Requirement 1
- [ ] Requirement 2

## Data Model
<New tables or columns needed, or "No schema changes required">

## Routes
<New pages and API routes>

## Out of Scope
<Things explicitly NOT included in this feature>

## Test Cases
- [ ] Test case 1
- [ ] Test case 2

## Open Questions
- Question 1?
```

Make sure the `docs/features/` directory exists first.

## Step 4: Present the Plan

Show the user:
- The requirements doc path
- Recommended workflow
- Suggested first step (e.g., "Run `/tech-lead` to get a technical design before implementing")
- Any permissions that need to be set up (point to `/add-permission`)

**IMPORTANT**: Do NOT write any implementation code. This command only creates planning artifacts.

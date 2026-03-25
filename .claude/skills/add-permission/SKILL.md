---
name: add-permission
description: Add a new feature permission to the permission system with migration and role assignment
argument-hint: "[permission.key]"
---

# Add Feature Permission

When the user invokes `/add-permission`, walk through adding a new feature permission. The permission key may be provided as `$ARGUMENTS` (e.g., `events.export`).

## Step 1: Gather Information

Ask the user (if not already provided):

1. **Permission key** — Dot-notation key (e.g., `members.export`, `events.create`)
2. **Description** — Human-readable description for the admin UI
3. **Default roles** — Which roles should have this permission by default? Check existing roles by looking at `drizzle/migrations/` seed data or querying the DB.

## Step 2: Find or Create the FEATURES Constant

Check if a `FEATURES` constant exists anywhere in `src/lib/`:
```bash
grep -r "FEATURES" src/lib/ --include="*.ts" -l
```

If a permissions/features file exists (e.g., `src/lib/permissions.ts`), add to it:
```typescript
export const FEATURES = {
  // ... existing features ...
  NEW_FEATURE_KEY: "permission.key",
} as const;
```

If no such file exists, create `src/lib/permissions.ts`:
```typescript
export const FEATURES = {
  NEW_FEATURE_KEY: "permission.key",
} as const;
```

Follow the naming convention: constant name is UPPER_SNAKE_CASE, value is dot-notation.

## Step 3: Create a Migration

Create a new numbered SQL migration file in `/drizzle/migrations/`:

Check the highest existing number:
```bash
ls drizzle/migrations/*.sql | sort | tail -3
```

Create `drizzle/migrations/NNNN_add_permission_name.sql`:

```sql
-- Add permission.key feature permission
INSERT INTO features (name, description, category)
SELECT 'permission.key', 'Human-readable description', 'category'
WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'permission.key');

-- Assign to default roles (adjust role names/IDs based on your schema)
INSERT INTO role_features (role_id, feature_id)
SELECT r.id, f.id
FROM roles r, features f
WHERE r.name = 'Admin' AND f.name = 'permission.key'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf
    JOIN roles r2 ON rf.role_id = r2.id
    JOIN features f2 ON rf.feature_id = f2.id
    WHERE r2.name = 'Admin' AND f2.name = 'permission.key'
  );
```

> Note: Check the `features` and `role_features` table structure in `src/lib/db/schema.ts` to use the correct column names.

## Step 4: Update CLAUDE.md

If there is an Available Permissions table in `CLAUDE.md`, add the new entry:

```
| `permission.key` | Description |
```

## Step 5: Run the Migration

```bash
export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate
```

Verify it succeeded.

## Step 6: Show Usage Examples

```typescript
// API route protection
import { FEATURES } from "@/lib/permissions";

const session = await auth();
if (!session?.user?.features?.includes(FEATURES.NEW_FEATURE_KEY)) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// UI conditional rendering
const canExport = session?.user?.features?.includes(FEATURES.NEW_FEATURE_KEY);
{canExport && <ExportButton />}
```

## Summary

Present what was created/modified:
- Permission key and description
- Migration file path
- Files modified
- Roles with access
- Migration run status

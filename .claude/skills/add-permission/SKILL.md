---
name: add-permission
description: Add a new feature permission to the permission system with an idempotent migration and role binding
argument-hint: "[permission.key]"
---

# Add Feature Permission

When the user invokes `/add-permission`, walk through adding a new feature permission to the project's permission system. The permission key may be provided as `$ARGUMENTS` (e.g., `events.export`).

This project uses `FEATURES` in `src/lib/permissions.ts` as the static catalog (client-safe), and `hasFeature()` for the runtime check. Role bindings live in the database — seeded and updated through idempotent migrations under `drizzle/migrations/`.

## Step 1: Gather Information

Ask the user (if not already provided):

1. **Permission key** — dot-notation (e.g., `events.export`, `members.invite`).
2. **Constant name** — UPPER_SNAKE_CASE for the `FEATURES` object (e.g., `EVENTS_EXPORT`).
3. **Human-readable name** — for the admin UI (e.g., "Export events").
4. **Description** — one sentence; shown next to the name in the admin roles editor.
5. **Category** — match an existing category (`members`, `events`, `campaigns`, `groups`, `announcements`, `admin`, `reports`) or add a new one.
6. **Default roles** — which roles get this permission on a fresh install? Usually `Admin`. Sometimes also `Member`. Rarely none (the user assigns it manually later).

## Step 2: Update `src/lib/permissions.ts`

Add the new key to the `FEATURES` constant (preserve the category ordering):

```typescript
export const FEATURES = {
  // ... existing entries ...
  EVENTS_EXPORT: "events.export",
} as const;
```

Add the matching `FEATURE_DESCRIPTIONS` entry if the file uses that map:

```typescript
[FEATURES.EVENTS_EXPORT]: "Export events to CSV.",
```

If a new category is needed, add it to `FEATURE_CATEGORIES`.

## Step 3: Create the Migration

Find the next migration number:

```bash
ls drizzle/migrations/*.sql | sort | tail -3
```

Create `drizzle/migrations/NNNN_add_events_export_permission.sql` with **idempotent** statements (every migration in this project re-runs on every deploy):

```sql
-- Add events.export feature permission
INSERT INTO features (key, name, description, category)
SELECT 'events.export', 'Export events', 'Export events to CSV.', 'events'
WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = 'events.export');

-- Bind to the Admin role
INSERT INTO role_features (role_id, feature_key)
SELECT r.id, 'events.export'
FROM roles r
WHERE r.name = 'Admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf
    WHERE rf.role_id = r.id AND rf.feature_key = 'events.export'
  );
```

> Check the actual column names in `src/lib/db/schema.ts` before writing the SQL — the columns are `key`/`name`/`description`/`category` on `features`, and `role_id`/`feature_key` on `role_features` (verify against the current schema).

For an existing database, the migration will only *add* the binding; it will not revoke it from any role that already has the permission via custom assignment. That's the right behavior.

## Step 4: Apply the Migration Locally

```bash
export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate
```

Verify it succeeded. If your schema changes too, follow with `pnpm db:push`.

## Step 5: Use the New Permission

The two consumer patterns are:

**API route handler / server action:**
```typescript
import { auth } from "@/lib/auth";
import { FEATURES, hasFeature } from "@/lib/permissions";

const session = await auth();
if (!hasFeature(session?.user?.features, FEATURES.EVENTS_EXPORT)) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

**UI conditional render:**
```typescript
const canExport = hasFeature(session?.user?.features, FEATURES.EVENTS_EXPORT);
{canExport && <ExportEventsButton />}
```

## Step 6: Document and Release-Note

- If `CLAUDE.md` maintains a feature/permission inventory, add the new row.
- Run `/release-notes` to record the new permission in the current release notes file.

## Summary

Present what changed:

- New `FEATURES.<KEY>` constant in `src/lib/permissions.ts`
- New migration file: `drizzle/migrations/NNNN_*.sql`
- Role bindings added (which roles get it on fresh install): list
- Local migration run: PASS / FAIL
- Files modified

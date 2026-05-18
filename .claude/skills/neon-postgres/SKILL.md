---
name: neon-postgres
description: Patterns and guidance for working with Neon Postgres in this project — Drizzle Kit usage, idempotent migrations, branching for schema work, and the Neon docs as source of truth.
---

# Neon Postgres in the Westerville Lions Club Website

This project uses Neon — a serverless Postgres platform that separates compute and storage to offer autoscaling, branching, instant restore, and scale-to-zero. It is fully Postgres-compatible and works with the Drizzle ORM stack this codebase uses.

This skill captures the patterns most relevant to working in *this* codebase. For broader Neon questions, fall back to the official docs.

## Environment Variables in This Project

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Used by the app (`src/lib/db/index.ts`) and the migration runner (`drizzle/run-migrations.mjs`). Pooled (`-pooler`) host recommended. |

If you add a Drizzle Kit step that needs DDL through a non-pooled connection, document the variable in `CLAUDE.md` first.

## Drizzle Kit and Migration Commands

The project ships three relevant commands:

- **`pnpm db:migrate`** — runs `node drizzle/run-migrations.mjs`, which applies every SQL file under `drizzle/migrations/` against `DATABASE_URL`. Migrations re-run on every deploy and on every `pnpm dev` startup, so **every statement must be idempotent**.
- **`pnpm db:push`** — runs `drizzle-kit push`, which compares `src/lib/db/schema.ts` to the live database and applies the difference. Fast and effective during development. The production build uses `drizzle-kit push --force` after the SQL migrations run.
- **`pnpm build`** — runs the migration script, then `drizzle-kit push --force`, then `next build`. This is the production pipeline.

`schema.ts` is the source of truth for the Drizzle Kit step. Anything in the live database that isn't in `schema.ts` will be dropped on `db:push`.

## Idempotent Migration Patterns

Because migrations re-run on every deploy, every SQL statement must be safe to execute repeatedly:

```sql
-- Table
CREATE TABLE IF NOT EXISTS my_table (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Column
ALTER TABLE my_table ADD COLUMN IF NOT EXISTS notes text;

-- Seed
INSERT INTO features (key, name, description, category)
SELECT 'area.action', 'Display name', 'Description.', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM features WHERE key = 'area.action');

-- Index (guarded)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_my_table_created_at') THEN
    CREATE INDEX ix_my_table_created_at ON my_table(created_at);
  END IF;
END $$;
```

When migrating data, try the old shape first, then the new — never reference a column that may not yet exist.

## Branching for Schema Work

Neon's killer feature is **branches** — instant, copy-on-write clones of your database with their own compute endpoint. Use them for any non-trivial schema change.

The recommended loop:

1. **Create a Neon branch** off `main` from the Neon console (or with the Neon CLI: `neonctl branches create --name feature/event-rsvps`).
2. **Grab the branch's connection string** and point `.env.local`'s `DATABASE_URL` at it.
3. **Iterate freely** — write the SQL migration, run `pnpm db:migrate`, run `pnpm db:push`, refine `schema.ts`, repeat.
4. **When the migration is right, commit it.** It will re-run on the production deploy.
5. **Delete the Neon branch** when the feature ships.

The point is that schema mistakes never touch production data — they happen on a disposable branch that can be deleted with one command.

## Pooled vs Direct Connections

The app uses the pooled host (`-pooler` suffix in the URL) for runtime serverless workloads. Neon's PgBouncer multiplexes connections so a bursty serverless workload doesn't exhaust the Postgres connection limit. If you ever need a direct (unpooled) connection for a one-off script that runs DDL, get the unpooled connection string from the Neon console and use it locally — do not commit it to the repo.

## Scale-to-Zero and Cold Starts

By default, Neon's compute suspends after a few minutes of inactivity and resumes on the next query. The first query after suspend has a noticeable cold-start penalty (hundreds of milliseconds). This usually doesn't matter, but if you're benchmarking, that's why the second request is faster.

Storage stays active while compute is suspended, so data is never paged out.

## Useful Patterns

### Working with the Drizzle client

```typescript
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const row = await db.query.members.findFirst({ where: eq(members.email, email) });
```

### Raw SQL escape hatch

```typescript
import { sql } from "drizzle-orm";
const result = await db.execute(sql`SELECT count(*) FROM members`);
```

Use sparingly. Almost everything in this codebase can be expressed via Drizzle's query builder, and the type safety is worth keeping.

### Connection in a one-off script

The project's `scripts/` directory holds `tsx` scripts that connect via Drizzle. They typically use `dotenv -e .env.local` to load credentials so the script can be run locally without exporting env vars.

## Neon Documentation

The Neon docs are the source of truth for platform behavior. Always verify against the docs before relying on a feature claim — Neon evolves.

- **Docs index:** https://neon.com/docs/llms.txt
- **Branching:** https://neon.com/docs/introduction/branching
- **Connection pooling:** https://neon.com/docs/connect/connection-pooling
- **Scale to zero:** https://neon.com/docs/introduction/scale-to-zero
- **Instant restore:** https://neon.com/docs/introduction/branch-restore
- **Neon CLI (`neonctl`):** https://neon.com/docs/reference/neon-cli

Any Neon doc page is available as Markdown by appending `.md` to the URL — useful when you want to fetch a single page rather than navigate the site.

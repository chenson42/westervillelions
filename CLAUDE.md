# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Westerville Lions Club Website - A public-facing website and member portal for the Westerville Lions Club. Built with Next.js 16 (App Router), TypeScript, PostgreSQL with Drizzle ORM, and NextAuth.js 5.0.

**Current Website:** https://westervillelions.org/ (reference for content)

**Mission Statement:** "Create and foster a spirit of understanding among all people for humanitarian needs by providing voluntary services through community involvement."

**Key Principles:**
- Promoting understanding among world populations
- Supporting good governance and citizenship
- Advancing community civic, cultural, social, and moral welfare

## Brand Guidelines

**Colors:**
- Primary: Blue (`lions-blue` / `#1a56db`) - main brand color used throughout the site
- Accent: Gold (`lions-gold` / `#FFD700`)
- Dark Blue: `lions-blue-dark` / `#1e40af` for hover states and gradients

**Focus:**
- Emphasize **broad community service** and volunteer engagement
- De-emphasize eyecare programs (the current website over-indexes on vision/eyeglasses)
- Highlight diverse humanitarian activities and local civic involvement

## Technology Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Database:** PostgreSQL with Drizzle ORM
- **Authentication:** NextAuth.js 5.0
- **Styling:** Tailwind CSS v4
- **UI Components:** shadcn/ui (Radix UI primitives)
- **Package Manager:** pnpm
- **Node Version:** 20.x (see .nvmrc)

## Common Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start development server on localhost:3000
pnpm build            # Build for production (migrate + push + next build)
pnpm build:only       # Build without database changes
pnpm db:migrate       # Run SQL migrations only
pnpm db:push          # Push schema changes to PostgreSQL
pnpm lint             # Run ESLint validation
```

**Windows note:** `pnpm build:only` uses Unix-style inline env vars. Use Git Bash on Windows.

## Project Structure

```
src/
├── app/
│   ├── (public)/          # Public website pages
│   │   ├── page.tsx       # Homepage
│   │   ├── about/         # About the club
│   │   ├── mission/       # Mission & service areas
│   │   ├── events/        # Public events calendar
│   │   ├── donate/        # Donation page (Givebutter integration)
│   │   └── contact/       # Contact information
│   ├── (auth)/            # Authentication pages
│   │   └── signin/        # Login page
│   ├── (dashboard)/       # Member portal (authenticated)
│   │   ├── members/       # Member directory
│   │   ├── events/        # Internal events & signups
│   │   └── admin/         # Admin functions
│   └── api/               # API routes
├── components/            # React components
│   ├── ui/               # shadcn/ui components
│   ├── layout/           # Layout components (header, footer, nav)
│   └── public/           # Public website components
├── lib/                  # Utility libraries
│   ├── db/              # Database connection & schema
│   ├── auth/            # Authentication utilities
│   └── utils.ts         # General utilities
└── types/               # TypeScript type definitions
```

## Key Features

### Public Website
- **Homepage:** Hero section, mission statement, featured activities
- **About:** Club history, leadership, meeting times/location
- **Mission:** Service areas (youth, community, humanitarian, international)
- **Events:** Public events calendar and past events
- **Donate:** Integration with Givebutter donation platform
- **Contact:** Contact form, meeting info, social media links

### Member Portal
- **Login:** Google OAuth (via Google for Nonprofits) + password authentication
- **Member Directory:** Contact information for club members
- **Events:** Internal event calendar, RSVP system
- **Admin:** Member management, content updates

## Integrations

### Google for Nonprofits
- Google OAuth for member authentication
- Gmail API for email notifications (future)
- Google Calendar sync (future)

### Givebutter
- Donation platform integration on `/donate` page
- Embedded donation forms or redirect to Givebutter campaign
- Consider iframe embed vs. direct link

## Database Schema Patterns

### Path Alias
```typescript
import { db } from "@/lib/db";  // @/* maps to ./src/*
```

### Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `NEXTAUTH_URL` - Application URL
- `NEXTAUTH_SECRET` - NextAuth secret key
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `RESEND_API_KEY` - Email service API key (optional)

## Database Migrations

SQL migrations in `/drizzle/migrations/`. All migrations re-run on every deploy (no tracking table). Every migration must be fully idempotent.

**Critical Rules:**
1. Every statement must be idempotent (use `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, etc.)
2. Never reference objects that may not exist
3. Never reference objects created by later migrations
4. Try old schema first, then new

**Safe pattern for seed data:**
```sql
INSERT INTO roles (name, description)
SELECT 'Admin', 'Administrator role'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'Admin');
```

## Development Workflow

1. **DO NOT auto commit and push** — Always wait for explicit user approval. Production deploys from `main`.
2. **Test locally first** — Run `pnpm dev` and verify changes in the browser.
3. **Check build** — Run `pnpm build:only` before pushing.
4. **Run migrations after schema changes** — `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`
5. **Use `/pre-push` skill** — Before pushing, run `/pre-push` for automated pre-flight checks.
6. **Use `/new-feature` skill** — Before implementing a non-trivial feature, use `/new-feature` to scaffold planning docs.
7. **Use `/add-permission` skill** — When adding a new permission to the system.
8. **Use `/release-notes` skill** — When preparing to merge to main, write release notes and bump version.

## Agent Team

This project uses specialized Claude Code subagents. See `.claude/agents/` for their full definitions.

| Agent | Responsibility |
|-------|---------------|
| **tech-lead** | Technical design and implementation planning before any non-trivial feature |
| **database-admin** | Schema design, migrations, data integrity |
| **api-developer** | API routes, server-side logic, database operations |
| **ux-developer** | React components, pages, forms, UI |
| **full-stack-developer** | Small tightly-coupled features spanning API + UI |
| **architect** | Structural decisions, dependency evaluation, compliance review |
| **deployment-engineer** | Build verification, deployment readiness, production health |

### Workflow Selection

#### Full Workflow (Complex Features)
Use for new major features, architectural changes, features touching multiple subsystems.

1. **tech-lead** — Create technical design
2. **database-admin** — Schema changes (if needed)
3. **api-developer** — Build API endpoints
4. **ux-developer** — Build UI (can start after API contract is defined)
5. **deployment-engineer** — Verify build and deployment readiness

#### Standard Workflow (Medium Features)
Use for routine features with clear requirements.

1. **tech-lead** — Quick design (or skip if requirements are obvious)
2. **database-admin** — Schema changes (if needed)
3. **full-stack-developer** OR **api-developer** + **ux-developer** — Implement
4. **deployment-engineer** — Verify build

#### Fast Track (Simple Changes)
Use for bug fixes, minor UI tweaks, small improvements.

1. **full-stack-developer** — Implement fix/change
2. Quick build check, commit

### Agent Handoff Protocol

When one agent completes work and another picks up, provide:

```
[Agent] completed [task].

Status: ✅ Complete | ⚠️ Complete with notes | 🚧 Blocked

Artifacts:
- [files created/modified]
- [key decisions made]

For [next agent]:
- [specific info they need]
- [API contracts, data models, etc.]

Blockers: [any issues]
```

## Key Patterns

### Authentication
```typescript
// Check if user is authenticated
import { auth } from "@/lib/auth";
const session = await auth();
if (!session?.user) {
  redirect("/signin");
}
```

### Toast Notifications
```typescript
import { toast } from "sonner";
toast.success("Success message");
toast.error("Error message");
```

### Styling with Tailwind
- Use Tailwind CSS utility classes
- Custom brand colors: `bg-lions-blue`, `text-lions-gold`, `bg-lions-blue-dark`
- Responsive design: mobile-first approach

## Content Guidelines

### Writing Tone
- Warm, welcoming, community-focused
- Highlight impact and service
- Encourage volunteerism and membership

### Service Areas to Highlight
- **Youth Programs:** Scholarships, youth activities
- **Community Service:** Local initiatives, partnerships
- **Humanitarian:** Disaster relief, community support
- **Vision:** Still important, but not the primary focus
- **Environment:** Conservation efforts
- **Hunger Relief:** Food drives, meal programs

## Gotchas

- **Blue/gold theme:** Primary color is `lions-blue`, accent is `lions-gold` — do not use red
- **Google OAuth:** Requires Google for Nonprofits account setup
- **Givebutter:** May need API key or specific configuration for embeds
- **Mobile-first:** Ensure all pages are mobile-responsive

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Sections:** [Project Overview](#project-overview) · [Brand Guidelines](#brand-guidelines) · [Technology Stack](#technology-stack) · [Common Commands](#common-commands) · [Project Structure](#project-structure) · [Key Features](#key-features) · [Integrations](#integrations) · [Database Schema Patterns](#database-schema-patterns) · [Database Migrations](#database-migrations) · [Key Patterns](#key-patterns) · [UX Guidelines](#ux-guidelines) · [Content Guidelines](#content-guidelines) · [Gotchas](#gotchas) · [Agent Roster](#agent-roster) · [Development Pipeline](#development-pipeline) · [Periodic Reviews](#periodic-reviews) · [Document Naming](#document-naming) · [Workflow Rules](#workflow-rules) · [Key Invariants](#key-invariants)

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
- **Styling:** Tailwind CSS v3 (3.4.x)
- **UI Components:** shadcn/ui (Radix UI primitives)
- **Package Manager:** pnpm
- **Node Version:** 20.x (see .nvmrc)

## Common Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start development server on localhost:3000
pnpm build            # Build for production (migrate + push + next build)
pnpm build:only       # Build without database changes (recommended local pre-push)
pnpm db:migrate       # Run SQL migrations only
pnpm db:push          # Push Drizzle schema changes to PostgreSQL
pnpm lint             # Run ESLint validation
pnpm exec tsc --noEmit  # Type check only (no build)
pnpm test             # Vitest unit tests (run once)
pnpm test:watch       # Vitest in watch mode
pnpm test:e2e         # Playwright e2e tests (needs `pnpm dev` running)
```

**Windows note:** `pnpm build:only` uses Unix-style inline env vars. Use Git Bash on Windows.

## Project Structure

```
src/
├── app/
│   ├── page.tsx           # Public homepage
│   ├── about/             # About the club
│   ├── mission/           # Mission & service areas
│   ├── events/            # Public events calendar
│   ├── programs/          # Service programs
│   ├── donate/            # Donation page (Zeffy embedded donation forms)
│   ├── contact/           # Contact information
│   ├── join/              # Membership application
│   ├── meetings/          # Meeting info
│   ├── connect/           # Contact / social
│   ├── causes/, campaigns/  # Cause / campaign surfaces
│   ├── signin/            # Sign-in (Google OAuth + password)
│   ├── register/          # Account registration
│   ├── forgot-password/, reset-password/  # Password reset flow
│   ├── access-pending/    # Landing for authenticated users with no usable role
│   ├── (dashboard)/       # Admin portal (authenticated)
│   │   └── admin/         # Admin functions (users, roles, permissions, members, events, groups, campaigns, announcements, programs, membership, dues, ledger, subscriptions, suggestions, testimonials, email-queue, sync-log, security, release-notes, contact)
│   ├── members/           # Member portal (authenticated — auth() per page)
│   │   ├── events/        # Internal events & per-occurrence RSVP
│   │   ├── events/past/   # Past events list
│   │   ├── groups/        # Member group list and detail
│   │   ├── profile/       # Member profile and picture upload
│   │   ├── dues/          # Member's own dues payment history
│   │   ├── reimbursements/ # Member expense-reimbursement requests (The Ledger)
│   │   ├── impact/        # Philanthropy / community impact dashboard (impact.view gated when philanthropyVisibility='board'; open to any linked member when ='members')
│   │   └── financial-reports/  # Monthly Statement of Financial Condition (read-only, print-friendly; any linked member)
│   ├── api/               # API routes
│   ├── robots.ts          # robots.txt
│   └── sitemap.ts         # sitemap.xml
├── components/            # React components
│   ├── ui/                # shadcn/ui primitives + ConfirmDialog
│   ├── admin/             # Admin-only compositions
│   ├── public/            # Public marketing surfaces
│   ├── members/, events/, campaigns/, home/, join/, layout/  # Surface-specific
│   └── (top-level forms)  # contact-form, newsletter-form, membership-application-form, suggestion-box-*
├── lib/                   # Utility libraries
│   ├── db/                # Database connection & schema
│   ├── auth/              # NextAuth config + password-reset helpers
│   ├── hooks/             # Client-side React hooks (e.g., use-permissions)
│   ├── permissions.ts     # FEATURES catalog + hasFeature() (client-safe)
│   ├── permissions-server.ts  # Server-side permission helpers
│   ├── email.ts           # sendEmail() + email_queue helpers
│   ├── events.ts          # Event helpers
│   ├── members.ts         # Member helpers
│   ├── google-groups.ts   # Google Group sync
│   └── utils.ts           # General utilities
└── types/                 # TypeScript type declarations
drizzle/
├── migrations/            # Idempotent SQL migrations (re-run every deploy)
└── run-migrations.mjs     # Runner used by build + db:migrate
scripts/                   # One-off tsx scripts (roster import, sync-roster, etc.)
docs/
├── decisions.md           # ADR-style decision log
├── backlog.md             # Agreed-on feature ideas not yet started (B-nn IDs)
├── treasurer-todo.md      # Treasurer's living checklist (books/compliance follow-ups)
├── work-log/              # Per-feature pipeline tracking
├── reviews/               # Review log + detail files
├── release-notes/         # vX.Y.md files per minor version
└── features/              # Long-form feature specs (historical)
.claude/
├── agents/                # Agent definitions
└── skills/                # Slash-command skills
```

## Key Features

### Public Website
- **Homepage:** Hero section, mission statement, featured activities
- **About:** Club history, leadership, meeting times/location
- **Mission:** Service areas (youth, community, humanitarian, international)
- **Events:** Public events calendar and past events, with per-occurrence and full-series "Add to Calendar" (.ics) download
- **Donate:** Zeffy donation forms embedded per campaign
- **Contact:** Contact form, meeting info, social media links

### Member Portal
- **Login:** Google OAuth (via Google for Nonprofits) + password authentication
- **Member Directory:** Contact information for club members
- **Events:** Internal event calendar, per-occurrence RSVP system, "Add to Calendar" (.ics) download
- **Philanthropy Dashboard:** `/members/impact` — all-time and current-FY giving totals, giving by cause (CSS bar list), giving by fiscal year, recent named gifts. Two-tier gate: `impact.view` required when `philanthropyVisibility='board'`; any linked member when `='members'`.
- **Monthly Financial Statements:** `/members/financial-reports` — read-only, print-friendly Statement of Financial Condition (One Month / Twelve Months / Annual Budget columns) for the Club's Administrative fund and the Foundation's Charitable fund, reproducing the treasurer's monthly board reports. Open to any linked member, no `FEATURES` gate; a month only appears once every posted transaction on/before its last day is reconciled (auto-appears, no manual publish step).
- **Admin:** Member management, content updates, role/permission management, Google Group sync, campaigns, announcements, programs, users, membership applications, annual dues tracking, The Ledger (online accounting: books, reimbursements, compliance/990, reports, donors & acknowledgments, and an in-app Treasury User's Guide at `/admin/ledger/guide`), subscriptions, suggestions, testimonials, email-queue inspection, sync-log audit, failed-login security log, in-app release notes, and contact submissions

## Integrations

### Google for Nonprofits
- Google OAuth for member authentication
- Google Group sync (members ↔ committees) via `src/lib/google-groups.ts`
- Gmail API for email notifications (future)
- Google Calendar sync (future)

### Zeffy
- Donation platform for the `/donate` page — one card per row in the `campaigns` table
- Each card opens a Zeffy donation form in a modal via `ZeffyEmbed` (`src/components/campaigns/zeffy-embed.tsx`), which iframes `https://www.zeffy.com/embed/…`
- The CSP `frame-src` in `next.config.ts` must whitelist `https://www.zeffy.com`, or the browser blocks the iframe with "This content is blocked"
- Campaign cards show the campaign's stored `image`; when none is set they fall back to a local brand image (`/images/service-community.jpg`). Zeffy's Cloudflare 403s server-side fetches, so do not scrape Zeffy at request time.

### Resend
- Outbound transactional email via `sendEmail()` in `src/lib/email.ts`
- Messages enqueue into the `email_queue` table for delivery

### Cloudflare Turnstile
- Bot protection on public form submissions (contact, newsletter, membership application)

## Database Schema Patterns

### Path Alias
```typescript
import { db } from "@/lib/db";  // @/* maps to ./src/*
```

### Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (pooled host)
- `DB_URL` - Alias for `DATABASE_URL` (some deploy environments use the shorter name)
- `PROD_DATABASE_URL` - **Scripts only, never read by the app.** The one-off scripts under `scripts/` resolve their target as `PROD_DATABASE_URL || DATABASE_URL || DB_URL` and print a `*** TARGET: PRODUCTION ***` banner when the first is set. They stay dry-run until `--apply`. Because `.env.local` is loaded by every script, setting this there makes production the default target for all of them — including destructive ones like `clear-budget-fy.ts`. Comment it out to make dev the default again.
- `NEXTAUTH_URL` - Application URL
- `NEXTAUTH_SECRET` - NextAuth secret key
- `AUTH_SECRET` - Alias for `NEXTAUTH_SECRET` (fallback used by `src/lib/auth/index.ts`)
- `GOOGLE_CLIENT_ID` - Google OAuth client ID (sign-in)
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret (sign-in)
- `RESEND_API_KEY` - Resend API key (outbound email)
- `RESEND_FROM_EMAIL` - From-address for outbound mail (e.g., `Lions Club <noreply@your-domain>`)
- `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` - Cloudflare Turnstile (optional)
- `GOOGLE_GROUPS_CLIENT_ID` - OAuth client ID used by `src/lib/google-groups.ts` for Group sync
- `GOOGLE_GROUPS_CLIENT_SECRET` - OAuth client secret for Group sync
- `GOOGLE_GROUPS_REFRESH_TOKEN` - Refresh token used by Group sync (domain-wide delegation)
- `GOOGLE_ADMIN_EMAIL` - Workspace admin address used as the impersonation subject for Group sync

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

The build pipeline runs `pnpm db:migrate` (SQL migrations) then `drizzle-kit push --force` (sync `src/lib/db/schema.ts` to the live DB).

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

### Permission Gating
```typescript
import { FEATURES, hasFeature } from "@/lib/permissions";

if (!hasFeature(session.user.features, FEATURES.MEMBERS_EDIT)) {
  redirect("/access-pending");
}
```

### Toast Notifications
```typescript
import { toast } from "sonner";
toast.success("Success message");
toast.error("Error message");
```

### Email
```typescript
import { sendEmail } from "@/lib/email";

await sendEmail({
  to: member.email,
  subject: "Your RSVP is confirmed",
  html: "<p>...</p>",
});
```

### Styling with Tailwind
- Use Tailwind CSS utility classes
- Custom brand colors: `bg-lions-blue`, `text-lions-gold`, `bg-lions-blue-dark`
- Responsive design: mobile-first approach

## UX Guidelines

These standards must be followed consistently across all pages.

### Card Styles

**Interactive cards** (clickable, hoverable — events, groups, service areas, campaigns):
```
bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden
```

**Non-interactive cards** (informational — member list items, detail panels):
```
bg-white rounded-2xl shadow-sm overflow-hidden
```

Never mix `rounded-xl` and `rounded-2xl` in card containers. Always use `rounded-2xl`.

### Empty States
```
bg-gray-50 rounded-2xl p-10 text-center text-gray-500
```

### Buttons

**Primary button:**
```
bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition
```

**Secondary button (outlined):**
```
border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition
```

**Always use `rounded-lg`** — never `rounded-full` for buttons, even in hero sections.

Hero buttons may use larger padding (`px-8 py-4`) and `text-lg`, but must still use `rounded-lg`.

### Confirm / Destructive Actions

**Never use `window.confirm()`, `window.alert()`, or `window.prompt()`.** These are browser-native dialogs that cannot be styled, block the main thread, and are inconsistent across platforms.

Always use `<ConfirmDialog>` from `@/components/ui/confirm-dialog` instead:

```tsx
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const [deleteOpen, setDeleteOpen] = useState(false);

<button onClick={() => setDeleteOpen(true)}>Delete</button>
<ConfirmDialog
  open={deleteOpen}
  onOpenChange={setDeleteOpen}
  title="Delete item?"
  description="This action cannot be undone."
  confirmLabel="Delete"
  destructive
  onConfirm={handleDelete}
/>
```

Use `destructive` prop for irreversible actions — renders the confirm button in red.

### Colors

- **On dark (blue) backgrounds:** social icon hover = `hover:text-lions-gold`
- **On light backgrounds:** social icon hover = `hover:text-lions-blue`
- Use `lions-gold` as an accent (badges, highlights, section labels), not as a card border
- Do not use `lions-red` — it is not defined in the theme and renders transparent

### Page Hero Banners

**Public pages** (`py-20` with blue gradient):
```
bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-20
```

**Member portal pages** (`py-12` — secondary context):
```
bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12
```

Public page subtitles use a gold eyebrow label with `uppercase tracking-widest text-sm text-lions-gold mb-2`.

### Links

- Back links: `text-lions-blue hover:underline` with `&larr;` arrow
- Inline "learn more" / "see all" links: `text-sm font-semibold text-lions-blue hover:text-lions-blue-dark` with SVG arrow icon
- All interactive links must have `focus:outline-none focus:ring-2 focus:ring-lions-blue rounded` for accessibility

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

- **Blue/gold theme:** Primary color is `lions-blue`, accent is `lions-gold` — do not use red (`lions-red` is undefined and renders transparent)
- **Google OAuth:** Requires Google for Nonprofits account setup
- **Zeffy:** Embedded donation forms are iframes — CSP `frame-src` in `next.config.ts` must allow `https://www.zeffy.com`, and Zeffy 403s server-side fetches (no request-time scraping)
- **Mobile-first:** Ensure all pages are mobile-responsive
- **Migrations re-run on every deploy:** Every SQL statement must be idempotent
- **No native browser dialogs:** Use `<ConfirmDialog>` (or shadcn `Dialog`), never `window.confirm()` / `window.alert()` / `window.prompt()`

## Agent Roster

Agents live in `.claude/agents/`. Spawn the right one for the phase.

| Agent | Pipeline phase | When to invoke |
|-------|---------------|---------------|
| **analyst** | Phase 1 & 6 | Functional refinement before design; shipped-vs-intent review after QA. |
| **architect** | Phase 2 | New subdirectories, npm dependencies, structural changes. |
| **tech-lead** | Phase 3 | Before writing >50 lines; authors the design doc. |
| **database-admin** | Phase 4 (schema) | `schema.ts` changes, idempotent migrations, indexes. |
| **api-developer** | Phase 4 (server) | Route handlers, server actions, business logic. |
| **ux-developer** | Phase 4 (client) | React components, member portal and admin pages, forms. |
| **full-stack-developer** | Phase 4 (small/coupled) | Features small enough that splitting adds overhead. |
| **deployment-engineer** | Reactive | Invoked on demand; `/pre-push` covers the routine pre-deploy checklist. Production build verification, env vars, build failures. |
| **qa** | Phase 5 | Typecheck, production build, dev-server smoke, manual click-through, PASS/FAIL verdict. |

**The full six-phase pipeline is defined below. Every feature flows through it. Work is not complete until analyst issues SHIP IT in Phase 6.**

When handing off between phases, preserve the prior phase's full output in the work-log. Do not summarize away the analyst's gaps or the architect's invariant rulings.

## Development Pipeline

Every change — new feature or bug fix — flows through six phases. Loop-backs are expected.

```
Phase 1            Phase 2            Phase 3
─────────          ─────────          ─────────
analyst    ──►    architect   ──►    tech-lead
Functional         Architectural      Technical
refinement         review             design
   ▲                                    │
   │                                    ▼
   │                                  Phase 4
   │                                  ─────────
   │                                  Implementer
   │                                  (db-admin |
   │                                   api-developer |
   │                                   ux-developer |
   │                                   full-stack)
   │                                    │
   │                                    ▼
Phase 6            Phase 5
─────────          ─────────
analyst    ◄──    qa
Shipped vs         Verification
intent             (typecheck + build
sign-off            + manual click-through)
```

A loop-back from any later phase returns to the **earliest** phase where the failure originated, not just the previous phase.

### Phase 1 — Functional Refinement (analyst)

**Trigger:** New feature request or bug report.
**Output:** Five-pass review (user verbs, flow audit, permissions, gaps, adversarial pass).
**Gate:** Verdict must be `READY FOR DESIGN` or `READY WITH NOTES`.
**Loop-back:** `NEEDS REWORK` or `NOT YET` returns to the user. Pipeline pauses.

### Phase 2 — Architectural Review (architect)

**Trigger:** Phase 1 advanced.
**Output:** Verdict on directory placement, server/client split, dependency requirements, invariant compliance.
**Gate:** `Approved` or `Approved with suggestions`.
**Loop-back:** `Needs revision` returns to Phase 1 if the feature shape is wrong; otherwise the architect documents the resolution and advances.

### Phase 3 — Technical Design (tech-lead)

**Trigger:** Architect approved Phase 2.
**Output:** Design doc covering permissions, API contract, data model, component plan, implementation order, edge cases.
**Gate:** Design complete and the implementer is named.
**Loop-back:** Architectural concern returns to Phase 2. Functional inconsistency returns to Phase 1.

### Phase 4 — Implementation

**Trigger:** Tech-lead's design is complete.
**Implementer selection:**

| Scope | Implementer |
|-------|-------------|
| Schema only | **database-admin** |
| Route handlers, server actions, server logic | **api-developer** |
| React components, pages, forms | **ux-developer** |
| Spans server + client and is small | **full-stack-developer** |

**Specialist split vs. full-stack:** For a large feature with new schema + API + UI, run the specialist split (database-admin → api-developer → ux-developer) — every increment of The Ledger ran this way cleanly. Reserve **full-stack-developer** for work that is small and tightly coupled (~< 150 lines across API + UI) where a handoff would add more overhead than it removes.

**Gate:** Typecheck passes. The production build (`pnpm build:only`) passes. No native browser dialogs. No `console.log` left in production paths. All invariants honored. Migrations are idempotent. Auth + `hasFeature()` gates present on every protected route/action. **Every unit test named in the Phase 3 design doc is written and passing** — the implementer delivers these, not qa.
**Loop-back:** Design unbuildable returns to Phase 3. Architectural problem discovered returns to Phase 2.

### Phase 5 — Verification (qa)

**Trigger:** Implementer reports Phase 4 complete.
**Output:** Build Verification Report in the work-log — typecheck, production build, dev-server smoke test, manual click-through of the user-facing flow.
**Gate:** Verdict must be `PASS`.
**Loop-back:** `FAIL` returns to the implementer (Phase 4) with the failing flow cited. If a failure reveals a design flaw, escalate to Phase 3.

### Phase 6 — Shipped vs Intent (analyst)

**Trigger:** QA's PASS.
**Output:** Final verdict comparing the shipped feature to the Phase 1 description.
**Gate:** Verdict must be `SHIP IT`. **No other verdict closes the pipeline.**
**Loop-back:** `SHIP WITH NOTES` ships, but each note becomes a tracked follow-up. `NEEDS REWORK` returns to Phase 3 or 4 depending on the issue.

### Bug-Fix Variant

| Phase | Bug-fix behavior |
|-------|-----------------|
| 1 (analyst) | Brief — confirms the bug is real and that the fix preserves intended behavior. |
| 2 (architect) | Skip if the fix doesn't touch invariants; document the skip in the work-log. |
| 3 (tech-lead) | Brief design or skip if the fix is trivial; document the root cause regardless. |
| 4 (implementer) | Writes the fix. Captures reproduction steps in the work-log. |
| 5 (qa) | Reproduces the original bug on the pre-fix code, then confirms the fix removes the failure. |
| 6 (analyst) | Confirms the bug no longer manifests for the user. |

**Skipping a phase requires explicit notation in the work-log. No silent skips.** Even a trivial bug fix gets a minimal work-log stub (slug, one-line root cause, reproduction steps, which phases were skipped and why) — the work-log is the pipeline's source of truth and an untracked fix is invisible to the next session.

### Per-Feature Tracking

Every piece of work gets a work-log file at `docs/work-log/YYYY-MM-DD-<slug>.md` (use the date the work started) from `docs/work-log/_template.md`. The work-log is the source of truth for pipeline state — Claude reads it at session start to determine where the work stands and which agent to invoke next.

## Treasurer's Todo

`docs/treasurer-todo.md` is the treasurer's living checklist — book-keeping, compliance, and
data-cleanup follow-ups flagged from the club's real books. When working on The Ledger or helping
manage the books, read it first, check off items as they're resolved (append date + outcome rather
than deleting), and add newly discovered flags to it. Items carry stable `T-nn` IDs for
cross-referencing from work-logs and board minutes.

## Periodic Reviews

Seven reviews run on rolling cadences to keep the codebase, docs, security posture, test coverage, instruction layer, dependency footprint, and the development process itself from drifting.

| Review | Cadence | Owner | Why it exists |
|--------|---------|-------|---------------|
| **Test coverage** | 7 d | qa | Coverage drifts faster than any other axis on a fast-moving project; a weekly sweep — Vitest unit tests, Playwright e2e, plus any manual click-throughs for flows the runner can't reach — catches gaps while the context for the missing tests is still recent. |
| **Retrospective** | 7 d | all agents → tech-lead synthesizes | Pipeline efficacy needs short feedback loops — a weekly retrospective produces concrete edits to agents and to this file before bad patterns calcify. |
| **Code** | 30 d | architect | Complexity hotspots, dead code, and quiet violations of invariants accumulate over weeks; a monthly pass keeps the codebase shaped the way the project is meant to be shaped. |
| **Documentation** | 30 d | tech-lead | Docs drift silently — a monthly audit catches stale environment-variable lists, broken cross-links, and CLAUDE.md sections that no longer match reality. |
| **Security** | 30 d | api-developer + database-admin | A monthly sweep of auth boundaries (Google OAuth scopes, NextAuth session shape, member-data exposure), Google Group sync surface, OAuth-token storage, dependency CVEs, and OWASP surface area. |
| **Agent & instruction** | 30 d | tech-lead | Agents and `.claude/` settings accumulate stale guidance, unused tools, and references to features that no longer exist; a monthly review keeps the instruction layer honest. |
| **Dependencies** | 30 d | deployment-engineer | A monthly review of `pnpm outdated` and `pnpm audit` keeps the dependency graph current without inviting weekly churn. |

Ownership claims for each review are reflected in the relevant agent file under `.claude/agents/` — read the named owner's agent file for the specifics of what each review covers and where its detail file lands.

### Cadence Check at Session Start

`docs/reviews/log.md` is the source of truth for review history. Before starting any non-trivial work, read it and check the most recent date for each review type against its cadence. If any review exceeds its cadence — or has never been run — surface this:

> "Three reviews are due before we start:
> - Test coverage: 12 days (last YYYY-MM-DD)
> - Code: never run
> - Documentation: 35 days
>
> Want me to run all three, run one (which?), or proceed and defer?"

If the user says proceed, do not append a fake log entry — the next session will surface the gap again.

**Trivial work skips the cadence check:** typo fixes, single-line config edits, answering codebase questions.

### Logging Outcomes

After a review, append one line to `docs/reviews/log.md`:

```
YYYY-MM-DD | <type> | <one-line outcome>
```

For substantial reviews, also write `docs/reviews/YYYY-MM-DD-<type>.md` with details and link it from the log entry.

## Document Naming

| Document type | Filename pattern | Example |
|---------------|------------------|---------|
| Work-log entry | `docs/work-log/YYYY-MM-DD-<slug>.md` | `docs/work-log/2026-05-18-volunteer-hours.md` |
| Review detail | `docs/reviews/YYYY-MM-DD-<type>.md` | `docs/reviews/2026-05-18-security.md` |
| Release notes | `docs/release-notes/vX.Y.md` | `docs/release-notes/v1.12.md` |
| Decision log | `docs/decisions.md` (single file, append at top) | `DECISION-007: ...` |

Slugs are short, lowercase, hyphenated, and stable. Don't rename them after the work-log is created.

## Workflow Rules

1. **Do not auto commit or push.** Wait for explicit user approval. Production deploys from `main`.
2. **No native browser dialogs.** `alert()`, `confirm()`, `prompt()` are forbidden anywhere in the app. Use `<ConfirmDialog>` from `@/components/ui/confirm-dialog` for destructive confirms, or shadcn `Dialog` for everything else.
3. **No secrets in committed files.** `.env.local` is gitignored; never read from `.env` files into committed code.
4. **Document decisions.** Architectural or implementation decisions go to `docs/decisions.md` (newest first, numbered).
5. **Use `/pre-push` before every push to `main`.** Typecheck, build, schema check, release notes. The skill never pushes — it only reports readiness.
6. **Run migrations after schema changes.** `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`. Every statement in `drizzle/migrations/` must be idempotent — migrations re-run on every deploy.
7. **Test locally before pushing.** Run `pnpm dev` and verify changes in the browser. Run `pnpm build:only` to confirm the production build passes.
8. **Never rewrite `main`'s history to diagnose an external-system failure.** If a deploy/CI failure appears after a push, the commit is rarely the cause — especially when the *same input* (identical commit/author) suddenly produces a *different result*, which means the external system's state changed, not your code. Get ground truth from the failing service's dashboard/logs **before** amending, re-authoring, or force-pushing. The 2026-06-24 Vercel deploy block (a duplicate Vercel account had claimed the GitHub login — see `docs/reviews/2026-06-24-retrospective.md` and the deployment-engineer agent's "external-system failures" note) cost three needless force-pushes that fixed nothing.
9. **Delegate substantive work to background agents; keep the main thread responsive.** For any non-trivial or multi-step work — investigations, feature implementation, reviews, data diagnostics, doc-heavy changes — spawn an agent (via the Agent tool, which runs in the background) rather than doing the work inline on the main thread. The main thread is for orchestration, clarification, quick reads, and relaying results, so the user can ask questions and redirect without waiting on a long-running task. Trivial single-step actions (one file read, a one-line edit, answering a question directly) may stay inline. When several pieces of work are independent, launch them as parallel background agents; when they share files or the working tree, sequence them.

## Key Invariants

### Server / Client Boundary

Next.js Server Components are the default. Add `'use client'` only when you need event handlers, hooks, refs, or browser APIs.

```typescript
// CORRECT — Server Component (default)
export default async function Page() {
  const session = await auth();
  return <main>{session?.user?.email}</main>;
}

// CORRECT — Client Component (interactivity)
"use client";
export function Toggle({ value }: { value: boolean }) {
  const [v, setV] = useState(value);
  return <button onClick={() => setV(!v)}>...</button>;
}
```

### Server Actions

Mark with `'use server'` at the top of the file or function. They run on the server; never trust their inputs without validation; always re-check session and permissions inside the action body.

### Auth Helpers and Database Access

The NextAuth config and helpers live in `src/lib/auth/`. Server-side code (route handlers, server actions, Server Components) can freely import both `@/lib/auth` and `@/lib/db`. There is no Edge-runtime middleware in this project that would forbid DB imports — protect routes inside the page or handler body with `auth()` + `hasFeature()` checks.

### Schema Is the Source of Truth

`src/lib/db/schema.ts` is canonical. Anything in the live database that isn't in `schema.ts` will be dropped on the next `pnpm db:push`. Add a new table to `schema.ts` *first*, then commit a matching idempotent SQL migration under `drizzle/migrations/`.

### Migrations Re-Run on Every Deploy

This project has no migration-tracking table. Every file in `drizzle/migrations/` is replayed on every deploy and on every `pnpm dev` startup. Every statement must therefore be idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `WHERE NOT EXISTS`, guarded `DO $$ … END $$` blocks for indexes). A non-idempotent migration will succeed locally and break the next deploy.

### Permissions Are the Only Gating Mechanism

The project uses a single feature-based permission system:

| Concept | Mechanism | Question it answers |
|---------|-----------|---------------------|
| Permission | `FEATURES` + `hasFeature()` | "Is this *user* allowed to do X?" |

There is **no separate environment-flag system**. If a feature should ship "off by default for everyone except admins," that's a role-binding choice in the migration — bind the new `FEATURES.*` key only to the `Admin` role until you're ready to widen it.

### No Secrets in Committed Files

`.env.local`, OAuth keys, `NEXTAUTH_SECRET`, the Resend API key — none of these belong in git. `.gitignore` already excludes `.env*`. Don't work around it.

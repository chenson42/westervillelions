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
- Primary: Blue (`lions-blue` / `#003F87`) - main brand color used throughout the site
- Accent: Gold (`lions-gold` / `#F9B222`, with `lions-gold-dark` / `#e09d0f` for hover)
- Dark Blue: `lions-blue-dark` / `#002d63` for hover states and gradients

Hex values above mirror `tailwind.config.ts` — the config is the source of truth; update this list if the tokens ever change.

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
│   ├── donate/            # Donation page (Zeffy embedded donation forms, EIN + impact band)
│   ├── privacy/           # Public privacy policy
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
│   │   └── admin/         # Admin functions (users, roles, permissions, members, events, groups, campaigns, announcements, programs, membership, dues, ledger, subscriptions, suggestions, testimonials, email-queue, sync-log, security, release-notes, contact, welcome-packets, proposals, social-requests)
│   ├── members/           # Member portal (authenticated — auth() per page)
│   │   ├── events/        # Internal events & per-occurrence RSVP
│   │   ├── events/past/   # Past events list
│   │   ├── groups/        # Member group list and detail
│   │   ├── profile/       # Member profile and picture upload
│   │   ├── dues/          # Member's own dues payment history
│   │   ├── reimbursements/ # Member expense-reimbursement requests (The Ledger)
│   │   ├── proposals/     # Project/activity proposals — submit, draft, track own status
│   │   ├── social-requests/  # Social media post requests — submit, edit pre-decision, track status
│   │   ├── records/       # Club Records hub — meeting minutes + governing documents (any linked member)
│   │   ├── records/documents/[slug]/  # Governing document current text, /history, /compare
│   │   ├── records/welcome-packet/  # Current welcome packet, DB-backed, live (any linked member)
│   │   ├── records/files/  # Club Files list — all uploaded PDFs, public and members-only (any linked member)
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
│   # NOTE: docs/treasurer-todo.md (T-nn) and docs/board-motions.md (Motion/Q-n/A-n)
│   # were REMOVED on 2026-08-12 when this repo was prepared for publication — they
│   # held the club's books, board deliberations and member data. Older work-logs,
│   # decisions and release notes still cite T-nn / Q-n identifiers; those live on in
│   # the private archive repository, not here. A dangling reference is expected, not a bug.
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
- **Project/Activity Proposals:** `/members/proposals` — any linked member submits a proposal (draft-saved, autosaved, 5 required + ~5 optional fields) and tracks its status; the board reviews at `/admin/proposals` under `proposals.review`. Decisions are an **append-only** `proposalDecisions` history (`Submitted / Under Review / Approved / Declined / Deferred`) so a repeated deferral never overwrites the prior record — DECISION-084. Money/date/headcount fields are **tri-state**: a nullable value paired with an `*Unknown` boolean, because "I don't know yet" and "left blank" are different answers. Visibility is proposer-or-`proposals.review`, enforced server-side. Approval deliberately triggers **no** automation — an approved proposal does not become an event, campaign, or budget line.
- **Social Media Post Requests:** `/members/social-requests` — any linked member requests the club post something to its social accounts (platform multi-select, post copy, optional image or link, desired post date, notes); editable/withdrawable until decided. The board reviews at `/admin/social-requests` under `social_requests.review` (bound to `admin` + `board_member`). Decisions are an **append-only** `socialRequestDecisions` history (`Posted / Declined / Deferred`), same shape as Proposals — a repeated deferral never overwrites the prior record. Submitting enqueues an email to `board@westervillelions.org` via `sendEmail()`, isolated from the DB write per the deny-by-default outbound email invariant. Deliberately no meeting-minutes citation trio (unlike Proposals) — a post request is operational, not a formal board commitment. No automation on decision.
- **Acknowledgment Letter Email:** `/admin/ledger/donors/letters` — emails an existing acknowledgment letter to the donor's addresses (all of them; `ledgerDonors.emails` is a flat `text[]` with no primary). **The claim is atomic on purpose**: `UPDATE ledger_acknowledgments SET sent_at = now(), sent_via = 'email' WHERE id = $id AND sent_at IS NULL RETURNING id` runs BEFORE any send, and a total send failure reverts it — a donor must never receive one receipt twice, nor have a row claim "sent" when nothing arrived. Results are regrouped by index, never by address: two donors can share one address. The treasurer is envelope-only (Reply-To/BCC), never body prose, because the letter carries its own signature block. **The UI must say "Emailed", never "Delivered"** — bounce visibility does not exist (B-47).
- **Club Files:** `/admin/club-files` — admins (`club_files.manage`, admin-only) upload PDFs (25MB cap) with a `public`/`members_only` visibility flag and attach them to events (`club_file_events` many-to-many). Bytes live in Postgres via `src/lib/club-file-storage/` (a **sibling** of receipt-storage, never `ledger_receipt_files` — DECISION-094) because document files can NEVER enter this public repo (the driving PDF carries personal emails; binary files evade the /pre-push PII grep). Uploads use a **chunked 3MB protocol** (DECISION-095) because Vercel hard-caps function request bodies at 4.5MB; downloads go through ONE route — `GET /api/club-files/[id]/download` — that re-checks visibility per request, 404s every failure (never 403), and returns a genuinely **streamed** Response (buffered responses hit the same 4.5MB cap). Replace-in-place swaps bytes under `SELECT ... FOR UPDATE` (no version history). Members see all files at `/members/records/files`; attached public files render on public event pages.
- **Event Announcement Emails:** `/admin/events/[id]/announce` — an `events.announce` holder (bound to `admin` + `board_member`; deliberately narrower than `events.edit`) emails every active member an event announcement from the club's domain, per-occurrence or full-series, with the .ics calendar file as a **true MIME attachment** (built by the same `src/lib/events.ts` helpers as the public ICS routes — never reimplemented). Attachments persist in `email_queue.attachments` (jsonb) because the queue's retry route bypasses `sendEmail()` and re-sends persisted rows directly — DECISION-092; dropping this would silently strip the calendar from retries. Every attempted recipient gets an `event_announcements` row under a shared `batchId` (success and failure alike, DECISION-093); members without email are shown, not dropped. Body is a fixed event-data template + optional note, signed "Westerville Lions Club". **UI says "Emailed", never "Delivered"** (B-47). Bulk send via `sendBulkMemberEmail()` as always.
- **Dues Reminders:** `/admin/dues/reminders` — the treasurer manually emails members whose dues are not recorded for the season. Signed by the holder of the Board `position = 'Treasurer'` via `resolveTreasurer()` (`src/lib/board-positions.ts`, DECISION-086), never by the sender; sending is gated separately on `dues.manage`. Partial payers are a separate, unchecked cohort with different wording; members with no email are shown, not dropped. Every send is recorded in `dues_reminders` (member + fiscal year) for the last-reminded badge. **Bulk member mail must go through `sendBulkMemberEmail()`** — never a hand-rolled loop over `sendEmail()`.
- **Club Records:** `/members/records` — meeting minutes (general, board, committee) and governing documents. Readable by any linked member; authored under `minutes.manage` / `documents.manage` (the **Notetaker** role, intended for the secretary), deleted under `minutes.delete`. Minutes are soft-deleted only and are retained permanently.
- **Governing Documents:** `/members/records/documents/[slug]` — the club's Constitution & By-Laws with full version history and side-by-side diffing. Versions are append-only: **corrections** take effect immediately, **amendments** stay `pending` until adopted under `documents.manage`, which records the adopter, the timestamp, and (optionally, backfillable) the citing minutes. The document's `currentVersionId` is the single source of truth for which text is operative.
- **Welcome Packet:** `/members/records/welcome-packet` — the club's annual new-member/orientation deck as a live, database-backed page (`welcomePackets` + a `welcomePacketCurrent` singleton pointer), not a git-committed file — the packet embeds the club's real giving/budget figures, so its content can never live in this public repo (see `docs/decisions.md` DECISION-090). Authored at `/admin/welcome-packets` under `welcome_packet.manage`, **admin-only by default** — this is load-bearing, since raw HTML is rendered as-authored (a documented, narrow exception to the project's no-raw-HTML-passthrough rule for admin-typed content). Editing an existing packet updates it in place; there is no version history. Members see only the packet marked current; `.flag` (board-review) annotations are always suppressed on the live page.
- **Monthly Financial Statements:** `/members/financial-reports` — read-only, print-friendly Statement of Financial Condition (One Month / Twelve Months / Annual Budget columns) for the Club's Administrative fund and the Foundation's Charitable fund, reproducing the treasurer's monthly board reports. Open to any linked member, no `FEATURES` gate; a month only appears once every posted transaction on/before its last day is reconciled (auto-appears, no manual publish step).
- **Admin:** Member management, content updates, role/permission management, Google Group sync, campaigns, announcements, programs, users, membership applications, annual dues tracking, event announcement emails, club files, The Ledger (online accounting: books, reimbursements, compliance/990, reports, donors & acknowledgments, and an in-app Treasury User's Guide at `/admin/ledger/guide`), meeting minutes, governing documents, project/activity proposals, social media post requests, subscriptions, suggestions, testimonials, email-queue inspection, sync-log audit, failed-login security log, in-app release notes, and contact submissions

### Admin-Area Protection Is Derived, Never Hand-Maintained

`src/proxy.ts` does **not** carry its own list of which permission guards which `/admin/*` area. It derives those rules from `ADMIN_NAVIGATION` via `getAdminProtectionRules()` (DECISION-082), so a new admin area is protected the moment it appears in the nav. Five separate features shipped locked-out because the two lists were maintained separately — do not reintroduce a hand-written rule table.

Two rules follow from this:

1. **The proxy is a coarse outer gate, not the gate.** Every admin page must still call `auth()` + `hasFeature()` in its own body. `src/lib/admin-page-feature-gates.test.ts` fails the build if an admin page ships without its own check.
2. **Widening a nav entry's permission widens proxy access.** Before broadening one, confirm every page under that segment gates independently — a page relying solely on the proxy will silently become reachable by the wider permission (this is exactly how `/admin/subscriptions` nearly leaked subscriber PII; it now has its own `subscriptions.view` key).

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
- `SEED_ADMIN_EMAIL` - Read by `drizzle/run-migrations.mjs` only, to substitute the `{{SEED_ADMIN_EMAIL}}` token a few migrations embed in a `WHERE u.email = '{{SEED_ADMIN_EMAIL}}'` seed. Grants that email's `users` row the `admin`/`treasurer`/`budget_committee` roles on the next `pnpm db:migrate`. Unset (the default) substitutes to an empty string, which matches no user — a safe no-op. Set this in your own `.env.local` after your first sign-in to bootstrap yourself as admin on a fresh install; not needed in production, where these grants were already applied historically.
- `SCRIPT_OPERATOR_EMAIL` - Read by several one-off `scripts/*.ts` (ledger corrections, category cleanups, event seeds) to attribute the write to a `users` row (`recorded_by_user_id`, `created_by`, audit-log actor). Required by those scripts; each throws a clear error if unset. Set it to your own account's email before running one.
- `SHARED_HOUSEHOLD_EMAIL` / `SHARED_HOUSEHOLD_EMAIL_ALT` / `SHARED_HOUSEHOLD_EMAIL_ALT_FIRST_NAME_MATCH` - Optional, read only by `scripts/import-roster.ts` and `scripts/sync-roster.ts`. Handles a roster where two household members share one email — gives the second member (matched by first-name substring) a distinct login. Unset (the default) is a no-op.
- `NEXTAUTH_URL` - Application URL
- `NEXTAUTH_SECRET` - NextAuth secret key
- `AUTH_SECRET` - Alias for `NEXTAUTH_SECRET` (fallback used by `src/lib/auth/index.ts`)
- `GOOGLE_CLIENT_ID` - Google OAuth client ID (sign-in)
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret (sign-in)
- `RESEND_API_KEY` - Resend API key (outbound email)
- `RESEND_FROM_EMAIL` - From-address for outbound mail (e.g., `Lions Club <noreply@your-domain>`)
- `EMAIL_DEV_ALLOWLIST` - Comma-separated addresses a **non-production** process may email. Unset or empty means nothing sends. Club distribution lists are refused even if listed. See *Outbound Email Is Deny-By-Default Outside Production*.
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

**Hero/CTA variant:** buttons in hero and CTA bands may add `transform hover:scale-105` (always paired with `transition`) for a subtle zoom on hover. Keep this to hero/CTA bands — regular in-page buttons don't zoom.

**Chips are not buttons:** small follow/tag pills (e.g., the homepage social-follow links) may use `rounded-full`; the `rounded-lg` rule applies to buttons only. Chips still need a 44px tap height (`py-3`) and a focus ring.

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

## Periodic Reviews

Seven reviews run on rolling cadences to keep the codebase, docs, security posture, test coverage, instruction layer, dependency footprint, and the development process itself from drifting.

| Review | Cadence | Owner | Why it exists |
|--------|---------|-------|---------------|
| **Test coverage** | 7 d | qa | Coverage drifts faster than any other axis on a fast-moving project; a weekly sweep — Vitest unit tests, Playwright e2e, plus any manual click-throughs for flows the runner can't reach — catches gaps while the context for the missing tests is still recent. |
| **Retrospective** | 7 d | all agents → tech-lead synthesizes | Pipeline efficacy needs short feedback loops — a weekly retrospective produces concrete edits to agents and to this file before bad patterns calcify. |
| **Code** | 30 d | architect | Complexity hotspots, dead code, **copy-pasted logic that should be one shared helper**, and quiet violations of invariants accumulate over weeks; a monthly pass keeps the codebase shaped the way the project is meant to be shaped. |
| **Documentation** | 30 d | tech-lead | Docs drift silently — a monthly audit catches stale environment-variable lists, broken cross-links, and CLAUDE.md sections that no longer match reality. |
| **Security** | 30 d | api-developer + database-admin | A monthly sweep of auth boundaries (Google OAuth scopes, NextAuth session shape, member-data exposure), Google Group sync surface, OAuth-token storage, dependency CVEs, OWASP surface area, **and a PII sweep of the repository itself — personal addresses, phone numbers, postal addresses, and any person hard-coded into a migration or script. The repo is public; see *No Personal Data in the Repository*.** |
| **Agent & instruction** | 30 d | tech-lead | Agents and `.claude/` settings accumulate stale guidance, unused tools, and references to features that no longer exist; a monthly review keeps the instruction layer honest. |
| **Dependencies** | 30 d | deployment-engineer | A monthly review of `pnpm outdated` and `pnpm audit` keeps the dependency graph current without inviting weekly churn. |

Ownership claims for each review are reflected in the relevant agent file under `.claude/agents/` — read the named owner's agent file for the specifics of what each review covers and where its detail file lands.

### Duplication Is a Review Finding, Not a Style Preference

The code review must flag **the same decision implemented in more than two places** and
require it be consolidated. This is a correctness rule, not tidiness: a rule living in twelve
places is twelve places to get it wrong and nowhere to change it.

The case that prompted it (2026-08-12): the from-address fallback for outbound mail was
copy-pasted **12 times**, an HTML escaper **6 times** (in three different shapes), and the app-URL
fallback **8 times**. One of those escaper copies had simply been omitted, sending
member-supplied text unescaped into an email delivered to the whole board — caught in review
by luck rather than by structure.

What is NOT duplication: many features calling the same helper. Eighteen `sendEmail()` call
sites are eighteen features that legitimately send different messages. The finding is the
boilerplate repeated *around* each call, not the calls.

When the reviewer finds it, the expected output is a backlog item with a count and a proposed
shared home — not a note that the code "could be DRYer".

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

### Outbound Email Is Deny-By-Default Outside Production

`sendEmail()` refuses to deliver to **any** address from a non-production process unless that
address is in `EMAIL_DEV_ALLOWLIST`. Blocked messages are still queued and still return
success, so callers and their tests behave exactly as in production; the message simply never
reaches Resend, and shows at `/admin/email-queue` as `blocked_non_production`.

This is deny-by-default because the deny-list version failed twice:

- **2026-08-09** — a QA run of the minutes email sent a real message to
  `club@westervillelions.org`, the ~44-person Google Group. The fix was to deny-list that
  address and `board@`.
- **2026-08-12** — a QA run created a pending disbursement in dev, which fired the existing
  board-approval notification and mailed **16 real board members** a fake $500 approval
  request. That path was neither a distribution list nor a bulk send, so nothing caught it.

A deny-list only protects the paths somebody remembered to enumerate, and there are ~18
`sendEmail()` call sites. `.env.local` carries the production `RESEND_API_KEY` and `next dev`
re-reads it, so a shell-level override does not survive — the block has to live in code.

**To receive test mail while developing,** put your own address in `EMAIL_DEV_ALLOWLIST`.
Never add another member's address, and never add a club distribution list (those are refused
even if allowlisted). **To email many members at once, use `sendBulkMemberEmail()`** — never a
hand-rolled loop over `sendEmail()`.

### No Personal Data in the Repository

**This repository is intended to be public.** Nothing in it may identify a member personally.

**Banned, without exception:**
- Personal email addresses (`@gmail.com`, `@att.net`, `@outlook.com`, anything not a club domain)
- Phone numbers, home or postal addresses
- Anything tying a named person to money, dues, health, or personal circumstances

**Allowed:**
- Club-domain addresses — `board@`, `club@`, `info@`, `treasurer@`, `noreply@westervillelions.org`. Organizational, already public, and several are load-bearing constants.
- Officer **names** in a governance context. The club publishes its officers on its own website; a name is not the problem, contact details are.
- `example.com` / `example.invalid` in tests and fixtures.

**Migrations and scripts must never hard-code a person to grant them access.** A `WHERE u.email = 'someone@example.com'` seed is both a leak and brittle — it silently stops working the day that person changes address. Drive it from an environment variable or a CLI argument.

**Why this is an invariant and not a preference.** On 2026-08-12 a `.env.local` backup was swept into a commit by `git add -A` and pushed, carrying every production credential; the same audit found nine personal addresses across 73 places, including inside migrations that ship to every deploy. The private repo is retained as an archive and the public project starts from a scrubbed tree — but that reset only buys one clean slate. `/pre-push` now fails on a personal address, and the 30-day security review owns the recurring check.

### No Secrets in Committed Files

`.env.local`, OAuth keys, `NEXTAUTH_SECRET`, the Resend API key — none of these belong in git. `.gitignore` already excludes `.env*`. Don't work around it.

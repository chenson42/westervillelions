# Documentation Review — 2026-05-27

**One-line outcome:** 7 findings across env vars, project structure, Tailwind version, decision log consistency, and release notes nav gaps; no blocking errors, all fixable in-band.

---

## Checked and Clean

- All `pnpm` scripts listed in CLAUDE.md (`install`, `dev`, `build`, `build:only`, `db:migrate`, `db:push`, `lint`, `test`, `test:watch`, `test:e2e`) exist in `package.json` and do what the doc claims.
- All public app routes listed in "Project Structure" (`about/`, `mission/`, `events/`, `programs/`, `donate/`, `contact/`, `join/`, `meetings/`, `connect/`, `causes/`, `campaigns/`, `signin/`, `register/`, `forgot-password/`, `reset-password/`, `access-pending/`) exist on disk.
- All `src/lib/` files listed (`permissions.ts`, `permissions-server.ts`, `email.ts`, `events.ts`, `members.ts`, `google-groups.ts`, `utils.ts`) exist.
- All `src/components/` subdirectories listed (`ui/`, `admin/`, `public/`, `members/`, `events/`, `campaigns/`, `home/`, `join/`, `layout/`) exist, plus all named top-level form components (`contact-form.tsx`, `newsletter-form.tsx`, `membership-application-form.tsx`, `suggestion-box-dialog.tsx`, `suggestion-box-launcher.tsx`).
- `src/types/` exists with `next-auth.d.ts`, `events.ts`, and `admin-rsvp.ts`.
- Release notes backward nav chains (v1.1 → v1.18 all have `← [vX.Y-1]`) are intact.
- DECISION-008 through DECISION-011 spot-checked against code: all named files exist at the stated paths.
- DECISION-009: rename confirmed — `add-to-calendar-dropdown.tsx` exists, `add-to-calendar-button.tsx` is gone.
- DECISION-010: `src/app/api/admin/members/lookup/route.ts` exists.
- Key features "Homepage," "About," "Mission," "Events," "Donate," "Contact," "Login," "Member Directory" all have corresponding routes/pages on disk.
- `docs/features/`, `docs/work-log/`, `docs/decisions.md`, `.claude/agents/`, `.claude/skills/` all exist.

---

## Finding 1 — Tailwind version mismatch

**Location:** CLAUDE.md → Technology Stack

**What's stale:** `"Styling: Tailwind CSS v4"` — `package.json` has `"tailwindcss": "^3.4.19"` and the installed version is `3.4.19`.

**What it should say:** `Tailwind CSS v3 (3.4.x)`

**Suggested correction:**
```
- **Styling:** Tailwind CSS v3 (3.4.x)
```

---

## Finding 2 — Missing env vars: Google Workspace service-account names, AUTH_SECRET alias, DB_URL alias

**Location:** CLAUDE.md → Database Schema Patterns → Environment Variables

**What's stale:** The entry reads "Google Workspace service-account variables - used by `src/lib/google-groups.ts` for Group sync" without naming the variables. Three additional env vars are in active use but undocumented:

| Var | Source | Used in |
|-----|--------|---------|
| `GOOGLE_GROUPS_CLIENT_ID` | Google Group sync | `src/lib/google-groups.ts` |
| `GOOGLE_GROUPS_CLIENT_SECRET` | Google Group sync | `src/lib/google-groups.ts` |
| `GOOGLE_GROUPS_REFRESH_TOKEN` | Google Group sync | `src/lib/google-groups.ts` |
| `GOOGLE_ADMIN_EMAIL` | Google Group sync (impersonation subject) | `src/lib/google-groups.ts` |
| `AUTH_SECRET` | NextAuth fallback | `src/lib/auth/index.ts` line 12: `secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET` |
| `DB_URL` | DB connection fallback | `src/lib/db/index.ts` lines 5-9: accepted as alias for `DATABASE_URL` |

`AUTH_SECRET` and `DB_URL` are fallback aliases, not replacements — CLAUDE.md documenting them prevents confusion when deploying to environments that use the shorter names.

**Suggested correction:** Replace the vague Google Workspace line with explicit names, and add the two alias vars with "(alias for ...)" notes.

---

## Finding 3 — Dashboard structure: members/ and events/ route paths are wrong

**Location:** CLAUDE.md → Project Structure → `(dashboard)` block

**What's stale:**
```
├── (dashboard)/       # Member portal (authenticated)
│   ├── members/       # Member directory
│   ├── events/        # Internal events & per-occurrence RSVP
│   └── admin/         # Admin functions ...
```

**Reality:** `(dashboard)` contains only `admin/`. The member-facing pages live at `src/app/members/` and `src/app/members/events/` — outside the `(dashboard)` layout group — and apply `auth()` protection individually. There is no `src/app/(dashboard)/members/` or `src/app/(dashboard)/events/` directory.

**What it should say:**
```
├── (dashboard)/       # Admin portal (authenticated)
│   └── admin/         # Admin functions (users, roles, members, events, groups,
│                       #   campaigns, announcements, programs, membership,
│                       #   subscriptions, suggestions, testimonials,
│                       #   email-queue, sync-log, release-notes, contact)
├── members/           # Member portal (authenticated — auth() per page)
│   ├── events/        # Internal events & per-occurrence RSVP
│   ├── events/past/   # Past events list
│   ├── groups/        # Member group list and detail
│   └── profile/       # Member profile and picture upload
```

---

## Finding 4 — Admin pages absent from Key Features

**Location:** CLAUDE.md → Key Features → Member Portal → Admin bullet

**What's stale:** The Admin bullet reads "Member management, content updates, role/permission management, Google Group sync, campaigns, announcements, programs." Several shipped admin surfaces are unlisted:

- `users` — user account management (add, edit, link to member)
- `membership` — membership application review
- `subscriptions` — newsletter subscriber management
- `suggestions` — member suggestion box triage
- `testimonials` — testimonial management
- `email-queue` — email delivery queue inspection
- `sync-log` — Google Group sync audit log
- `release-notes` — in-app release notes management

The doc is intentionally high-level here, but the current list is so incomplete it creates a false picture of scope. This is a minor gap — a catch-all phrase such as "...programs, users, membership applications, and more" would be sufficient.

---

## Finding 5 — DECISION-001 Impact section contradicts code (partially superseded by DECISION-002)

**Location:** `docs/decisions.md` → DECISION-001 Impact

**What's stale:** The Impact bullet reads:
> `src/lib/events.ts` — `generateOccurrences()` gains an optional `cancelledDates: Set<string>` parameter.

DECISION-002 (same date, 2026-05-18) explicitly reversed this ruling. The actual `generateOccurrences` signature in `src/lib/events.ts` has no `cancelledDates` parameter — `cancelledDates` lives only in `getNextOccurrence` and `findNextDayOfWeek`.

DECISION-001's **Status** is still `Resolved` rather than noting it was partially superseded. DECISION-002 does reference the ruling it corrects, but DECISION-001 has no back-reference to DECISION-002.

**Suggested correction:** Update DECISION-001 Status to `Partially superseded by DECISION-002` and strike through or annotate the `generateOccurrences` Impact bullet to note the correction.

---

## Finding 6 — Release notes forward nav gaps (v1.0–v1.11, v1.13)

**Location:** `docs/release-notes/v1.0.md` through `v1.13.md`

**What's stale:** Versions v1.0 through v1.11, and v1.13, are missing forward navigation links (`→ [vX.Y+1](...)`). This was addressed starting at v1.12 (which has `→ [v1.13]`), but older files were not retrofitted. Specifically missing:

| File | Missing link |
|------|-------------|
| v1.0.md | `→ [v1.1](v1.1.md)` |
| v1.1.md | `→ [v1.2](v1.2.md)` |
| v1.2.md | `→ [v1.3](v1.3.md)` |
| v1.3.md | `→ [v1.4](v1.4.md)` |
| v1.4.md | `→ [v1.5](v1.5.md)` |
| v1.5.md | `→ [v1.6](v1.6.md)` |
| v1.6.md | `→ [v1.7](v1.7.md)` |
| v1.7.md | `→ [v1.8](v1.8.md)` |
| v1.8.md | `→ [v1.9](v1.9.md)` |
| v1.9.md | `→ [v1.10](v1.10.md)` |
| v1.10.md | `→ [v1.11](v1.11.md)` |
| v1.11.md | `→ [v1.12](v1.12.md)` |
| v1.13.md | `→ [v1.14](v1.14.md)` |

These files are otherwise correct. The fix is mechanical — add a footer line to each.

---

## Finding 7 — `src/lib/hooks/` directory not mentioned in Project Structure

**Location:** CLAUDE.md → Project Structure → `src/lib/` block

**What's stale:** `src/lib/hooks/` exists (`use-permissions.ts`) but is not listed in the `lib/` section of Project Structure.

**Suggested correction:** Add `├── hooks/  # Client-side React hooks` to the `lib/` tree.

---

## Priority Recommendation

| Finding | Severity | Fix this session? |
|---------|----------|--------------------|
| 1 (Tailwind version) | Low — cosmetic | Yes — one-word fix |
| 2 (Missing env vars) | Medium — ops risk for new devs / deploys | Yes |
| 3 (Dashboard structure wrong) | Medium — causes confusion about routing | Yes |
| 4 (Admin features list) | Low — high-level section, not a source of truth | Defer |
| 5 (DECISION-001 status) | Low — internal consistency, not code-breaking | Defer |
| 6 (Release notes nav gaps) | Low — mechanical, cosmetic | Defer (bulk edit) |
| 7 (hooks/ missing) | Low — cosmetic | Defer |

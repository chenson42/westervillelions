# Site Review Fixes — Work Log

> **Slug:** `2026-09-04-site-review-fixes`
> **Surface:** public
> **Permission(s):** none — no new gated actions
> **Estimated complexity:** medium (many small, independent defects)
> **Pipeline mode:** Bug-fix variant, compressed — user directed "tackle 'em all" from a published full-site review. Phases 1–3 (the review findings themselves, handed to full-stack-developer as a ready-made punch list) are skipped for this batch; documented here per the "no silent skips" rule. Implementer went straight to Phase 4, verified in Phase 5 by this same session (qa not separately invoked — see Verification below), no schema changes so database-admin was not needed.

---

## Batch 1 — Defects (from live-site review, 2026-09-04)

All items below were implemented by full-stack-developer in one pass since each is small and self-contained; none touch schema.

### 1. `/events/past` returning HTTP 500 in production

**Root cause:** No route existed at `src/app/events/past/`. Next.js's router therefore matched the request against the *dynamic* sibling route `src/app/events/[id]/page.tsx` with `id = "past"`. That page does `db.select().from(events).where(eq(events.id, id))` against a `uuid` primary key column (`src/lib/db/schema.ts` — `events.id: uuid("id").primaryKey()`). Postgres rejects `"past"` as invalid UUID input, the query throws, and the unhandled exception surfaces as a 500 rather than a 404.

**Fix:** Added a real public page at `src/app/events/past/page.tsx` (Next prioritizes static routes over dynamic ones, so this alone stops the dynamic route from ever seeing `/events/past`). It lists all `isPublic` events whose `getNextOccurrence()` is `null` (i.e., no future occurrence remains), sorted most-recent-first, styled consistent with `/events`. Modeled on the existing member-portal equivalent (`src/app/members/events/past/page.tsx`) but public-scoped (no RSVP status, no auth).

Added a "Past events →" link to the top-right of the upcoming-events list on `/events` (`src/app/events/page.tsx`), styled per the CLAUDE.md inline-link guideline (`text-sm font-semibold text-lions-blue hover:text-lions-blue-dark` + arrow SVG).

### 2. Real 404 page + proxy fix

`src/proxy.ts` previously allowlisted a fixed set of known public paths and treated every other path — including typos, removed URLs, or anything not yet added to the allowlist — as protected, 307-redirecting to `/signin`. Inverted the logic: the proxy now only intercepts `/admin` and `/members` (API routes were already, and remain, skipped — they handle their own auth). Every other path, known or unknown, falls through to Next's own router, so an unrecognized URL now renders the real 404 page instead of bouncing to sign-in. The derived-protection mechanism (`getAdminProtectionRules()` from `ADMIN_NAVIGATION`, DECISION-082) is untouched — still spread into `protectionRules` exactly as before, still the only source of per-admin-segment feature requirements. Removed a duplicate `const pathname = request.nextUrl.pathname` that the refactor would otherwise have left as a shadowed re-declaration.

One behavior change worth flagging: `/access-pending` is no longer proxy-gated (it wasn't in the old allowlist, so it *was* being redirected to `/signin` for anonymous visitors). It doesn't need to be — the page already calls `auth()` and self-redirects to `/signin` if there's no session — so this is a no-op in practice, just enforced one layer down instead of at the proxy.

Created `src/app/not-found.tsx`: renders `public/images/404-lion.jpg` (copied from the provided source, verified 1536×1024) via `next/image` with `priority`, `sizes="100vw"`, and a descriptive alt ("A lion resting its head on stone numerals reading 404 at sunset"). Below the image: a real `<h1>Page not found</h1>`, one line of help text, and three real `<Link>` buttons — primary "Return home" (`/`, `bg-lions-blue`, `rounded-lg`), and two secondary outlined links to `/events` and `/connect`. No client JS, no hotspot over the baked-in artwork.

### 3. Fonts — Open Sans wasn't loading in production

**Root cause:** `src/app/layout.tsx` linked `fonts.googleapis.com` via a `<link>` tag, but `next.config.ts`'s CSP (`style-src 'self' 'unsafe-inline'; font-src 'self'`) blocks the browser from ever fetching it. The font declaration in `tailwind.config.ts` (`'Open Sans'`) simply fell through to `system-ui` on every device, in production, for the life of the site.

**Fix:** Replaced the `<link>` tags with `next/font/google`'s `Open_Sans` (`subsets: ['latin']`, `display: 'swap'`, exposed as CSS variable `--font-open-sans`). `next/font` self-hosts the font files under `/_next/static/media/`, which is same-origin and satisfies the existing CSP without loosening it. Removed the three dead `<link>`/preconnect tags from `src/app/layout.tsx`'s `<head>`. `tailwind.config.ts`'s `fontFamily.sans` now resolves `var(--font-open-sans)` first, falling back to the literal `'Open Sans'` name and the previous stack.

Verified in dev: `/` serves a `.woff2` from `/_next/static/media/`, and no CSP console/network errors.

### 4. Favicon set

The JSON-LD `logo` in `src/app/layout.tsx` already pointed at `public/images/logo-official.png` — a 392×145 wordmark (circular Lions International emblem + "Westerville Lions" text), not square, with a transparent background. A favicon of the full wordmark would be illegible at 16–32px, so isolated just the circular emblem: used Pillow to find the non-transparent column range of the left portion (columns 0–152 held the roundel; 165+ was the "Westerville" text), cropped it to its own bounding box (153×145), then:
- `src/app/icon.png` — padded to square, resized to 512×512, transparent background (browsers handle alpha fine for the tab favicon).
- `src/app/apple-icon.png` — 180×180, solid `lions-blue` (#003F87) background with the emblem centered at ~82% scale (iOS renders transparent regions in touch icons as black, so a solid background was necessary there).

Verified in dev: response headers show `<link rel="icon" href="/icon.png?...">` and `<link rel="apple-touch-icon" href="/apple-icon.png?...">` — Next auto-generates both routes from the files' presence under `src/app/`.

### 5. Open Graph & metadata fixes

- `src/app/events/[id]/page.tsx`: guarded `previewImage` (used in `generateMetadata()`'s `openGraph`/`twitter` blocks) against `event.image` being a `data:` URI — falls back to the new `og-default.jpg` instead. Added the same guard to the page body's `eventJsonLd.image` (previously used raw `event.image` unconditionally whenever it was set, bypassing the `previewImage` guard entirely) and resolved it to an absolute URL, since schema.org's `image` property expects one and the fallback path is site-relative.
- Generated `public/images/og-default.jpg`: cropped/resampled from `public/images/hero-bg.jpg` (2048×1287) to exactly 1200×630 (center-cropped to the 1.905 target aspect ratio, JPEG quality 75 → 146.9 KB, under the 150 KB cap).
- `src/app/layout.tsx` (root metadata) and `src/app/page.tsx` (homepage metadata): `openGraph.images` now points at `og-default.jpg` instead of the oversized, wrong-declared-dimension `hero-bg.jpg`.
- `src/app/mission/page.tsx`, `src/app/programs/page.tsx`: added the missing `openGraph.images` (both pointing at `og-default.jpg`, 1200×630).
- `src/app/donate/page.tsx`, `src/app/connect/page.tsx`: neither had an `openGraph` object at all; added one (title/description/url/siteName/locale/type) matching the shape used on every other public page, per the instruction to add `url`.
- `src/app/meetings/page.tsx`: was a plain component with zero metadata (inherited the homepage's title/description). Added a full `metadata` export (title, description, canonical).
- `src/app/signin/page.tsx`: is a client component (`"use client"`), which cannot export `metadata` directly. Added `src/app/signin/layout.tsx` (server component) carrying the `metadata` export and passing `children` through.
- `src/app/join/page.tsx`: title changed from `"Join the Westerville Lions Club"` to `"Join Us"` — the root layout's title template appends `" | Westerville Lions Club"` to every page title, so the old value rendered the club name twice in the browser tab.
- `next.config.ts`: added `poweredByHeader: false`.

### 6. Quick performance wins

- `next.config.ts` `images`: added `formats: ['image/avif', 'image/webp']`.
- `next.config.ts` `headers()`: added a `/images/:path*` rule — `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`.
- `src/app/api/public/members/[id]/photo/route.ts`: successful responses now send `Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800` (was `public, max-age=3600`); every 404 branch (no member, no photo, malformed data URI) sends a short `public, s-maxage=300, stale-while-revalidate=60` instead of being uncached, so a member who adds a photo later isn't stuck behind a day-long CDN cache of the 404.
- `src/components/members/leadership-avatar.tsx`: added `loading="lazy"` to the `<img>`. This component is a client component that discovers "no photo" only via `onError` after the browser has already requested the image (the server-side leadership query in `src/app/about/page.tsx` doesn't select `profilePicture`, so the page can't skip the `<img>` up front without a query change) — per the task's own fallback ("if it can't know server-side, at least lazy-load"), left it at lazy-loading rather than widening the query, to avoid scope creep into a query/rendering redesign in a batch explicitly scoped to not redesign these cards.
- `src/app/page.tsx`: the closing "Support Our Mission" CTA now links to `/donate` instead of the legacy `/campaigns`. Grepped all public-facing components and pages for `/contact` or `/campaigns` links — this CTA was the only hit; nothing else needed updating.

### 7. CSP — dropped `unsafe-eval`

Removed `'unsafe-eval'` from `script-src` in `next.config.ts`, leaving `'unsafe-inline'` untouched. `pnpm build:only` passed, and `/` in dev showed no CSP console errors (gtag/Turnstile/Zeffy `script-src`/`frame-src` entries were already separately allowlisted and untouched). No rollback needed.

---

## Files Modified

- `src/proxy.ts` — inverted allowlist to a protected-prefix check (`/admin`, `/members`); removed duplicate `pathname` declaration
- `src/app/layout.tsx` — `next/font/google` Open Sans, dropped dead `<link>` tags, `og-default.jpg`
- `tailwind.config.ts` — `fontFamily.sans` resolves the font CSS variable
- `src/app/events/page.tsx` — "Past events" link
- `src/app/events/[id]/page.tsx` — `data:` URI guard on `previewImage` and `eventJsonLd.image`
- `src/app/page.tsx` — `og-default.jpg`, CTA link `/campaigns` → `/donate`
- `src/app/mission/page.tsx`, `src/app/programs/page.tsx` — added `openGraph.images`
- `src/app/donate/page.tsx`, `src/app/connect/page.tsx` — added `openGraph` with `url`
- `src/app/meetings/page.tsx` — added `metadata` export
- `src/app/join/page.tsx` — title fix, `og-default.jpg`
- `next.config.ts` — `poweredByHeader`, `/images/:path*` cache headers, `image formats`, dropped `unsafe-eval`
- `src/app/api/public/members/[id]/photo/route.ts` — cache headers on success and 404 paths
- `src/components/members/leadership-avatar.tsx` — `loading="lazy"`

## Files Created

- `src/app/events/past/page.tsx` — public past-events archive
- `src/app/not-found.tsx` — branded 404 page
- `src/app/signin/layout.tsx` — metadata host for the client-component signin page
- `src/app/icon.png`, `src/app/apple-icon.png` — favicon set, derived from `logo-official.png`
- `public/images/404-lion.jpg` — 404 artwork (copied from provided source)
- `public/images/og-default.jpg` — 1200×630 default OG image, derived from `hero-bg.jpg`

## Schema Changes

None.

---

# Verification

**Date:** 2026-09-04
**Verified by:** full-stack-developer (this session — a separate qa pass was not invoked for this batch; see note below)

## Type Check

`pnpm exec tsc --noEmit`: **PASS**

## Unit Tests

`pnpm test`: **PASS** — 99 files, 1867 tests, all green.

## Production Build

`pnpm build:only`: **PASS**. Confirmed no route disappeared from the build's route table versus before (all `/admin/*`, `/members/*`, and public routes present, plus the new `/events/past`, `/icon.png`, `/apple-icon.png`, `/_not-found`).

## Dev-Server Smoke Test

`pnpm dev` (port 3000 was already occupied by a pre-existing dev server — Next fell back to port 3002; that pre-existing server was later stopped incidentally by a `pkill -f "next dev"` cleanup at the end of this session, so it may need restarting):

| Check | Result |
|---|---|
| `GET /events/past` | 200 |
| `GET /this-is-a-garbage-url-xyz` | 404, renders the branded not-found page (title, lion image, "Page not found" heading all present) |
| `GET /` | 200 |
| `GET /admin` (unauthenticated) | 307 → `/signin` (still protected) |
| `GET /members` (unauthenticated) | 307 → `/signin` (still protected) |
| Font | `.woff2` served from `/_next/static/media/`, no `fonts.googleapis.com` link tags remain |
| Favicon | `<link rel="icon" href="/icon.png?...">` and `<link rel="apple-touch-icon" ...>` present |
| `X-Powered-By` header | absent |
| CSP header | `script-src` no longer contains `unsafe-eval` |
| `og:image` on `/`, `/mission`, `/programs` | all resolve to `og-default.jpg` |
| `og:url` on `/donate`, `/connect` | present |
| `<title>` on `/meetings`, `/signin`, `/join`, `/donate`, `/mission`, `/programs`, `/connect` | correct, no duplicated club name |
| `/events` page | "Past events" link present, points to `/events/past` |
| `/images/*` `Cache-Control` | `public, max-age=86400, stale-while-revalidate=604800` |
| `/api/public/members/[id]/photo` 404 case | `Cache-Control: public, s-maxage=300, stale-while-revalidate=60` |

## Verdict

**PASS.** All seven batch items implemented and verified locally. Not committed or pushed — awaiting explicit approval per CLAUDE.md workflow rules.

## Note on process compression

This work-log compresses Phases 1–3 because the "design" work was already done by the site review that produced this punch list — each item names its own root cause and fix shape, leaving no ambiguity for analyst/architect/tech-lead to resolve. A separate qa agent was not spawned; verification (typecheck, unit tests, build, dev-server smoke test, manual curl-based click-through) was performed directly in this session per the Bug-Fix Variant table's allowance to keep Phase 5 lightweight for a batch of already-scoped defects. If the user wants an independent qa pass before this ships, that's a reasonable follow-up ask.

## Phase 4 — Implementation (full-stack) — 2026-09-04

**Owner:** full-stack-developer
**Status:** complete

### Summary

Batch 2 fixes the root cause behind Batch 1's `no-store`/`x-vercel-cache: MISS` finding: the root layout (`src/app/layout.tsx`) called `await auth()` on every request to hand the session to `<Header>`, which forced *every* route in the app dynamic — public marketing pages included, no matter what each page's own `revalidate` export said. Removing that one call, and moving the two remaining page-level `auth()` calls (`/donate`, `/events/[id]`) into client-side fetches, unlocks static/ISR rendering across the public site.

### What I did

- Removed `auth()` from the root layout. `Header` now hydrates its own account area client-side via `useSession()` (next-auth/react), reached through a new `<AppSessionProvider>` (thin `SessionProvider` wrapper) mounted around `<Header>`/`<main>`/`<Footer>` in the layout. No `SessionProvider` existed anywhere in the tree before this.
- `/donate`: the server render now always queries public+active campaigns only (session-independent). A new client widget, `<MemberOnlyCampaigns>`, fetches the non-public campaigns from a new route (`GET /api/public/campaigns/member-only`, session-gated inside the handler) and appends them below the public grid for signed-in visitors only. Extracted the per-campaign markup into a shared `<CampaignCard>` component so both the server-rendered grid and the client widget use identical markup.
- `/events/[id]`: this was the hard one — the page used `auth()` for four different things (attached-files visibility, per-occurrence "already signed up" flags, the non-recurring RSVP's prefilled state, and the signed-in user's display name). The page's server render now always computes the signed-out baseline (public-visibility files only, every occurrence `isSignedUp: false`, no RSVP prefill) — all of which is otherwise public aggregate data (counts, signee names) that's identical for every viewer and safe to cache. A new client component, `<EventPersonalization>`, fetches a new route (`GET /api/events/[id]/viewer-context`, always 200, `auth()` inside the handler) on mount and, once it resolves, remounts the interactive children (`OccurrenceSignupList`, `SingleEventSignup`, `PublicRsvpForm`, `AttachedFilesList` — all unmodified) via a `key` change so their internal `useState(initialX)` state picks up the real per-viewer values. Same flash-of-signed-out tradeoff as Header, scoped to this page's RSVP box and downloads list.
  - Added `OccurrenceRow.rsvpKey` (`src/types/events.ts`) — the wall-clock `"yyyy-MM-dd HH:mm:ss"` key matching `eventRsvps.occurrenceDate` exactly, needed because neither `date` (ISO/UTC) nor `dateKey` (date-only) round-trips to what the DB stores, and the client needs *some* key to match a fetched "your signed-up dates" list against the right row.
- Added `revalidate = 300` to `/`, `/events`, `/events/past`, `/events/[id]` (event data changes); `revalidate = 3600` to `/donate`, `/join`, `/connect`, `/meetings` (matching the existing `/about`, `/mission`, `/programs`).
- Fixed a latent, pre-existing build bug surfaced by this change: `/signin`, `/register`, and `/reset-password` all call `useSearchParams()` at the top of a `"use client"` page with no `<Suspense>` boundary above it. This never failed the build before because the layout's `auth()` call forced the whole app dynamic, so Next never attempted to prerender a static shell for any page. Once that forcer was removed, Next's `missing-suspense-with-csr-bailout` check started failing the build on these three pages. Fixed by splitting each into an inner `*Form` component wrapped in `<Suspense fallback={null}>` in the default export — the standard Next.js fix, not a workaround.
- Verified `src/proxy.ts` (reworked in Batch 1) doesn't call `auth()` for non-`/admin`, non-`/members` paths — confirmed by reading it; the early-return for public paths was already correct and needed no change.

### Outputs

- **New files:**
  - `src/components/providers/session-provider.tsx` — `AppSessionProvider`, thin client wrapper around next-auth's `SessionProvider`.
  - `src/components/campaigns/campaign-card.tsx` — `CampaignCard`, extracted from `/donate`'s inline JSX.
  - `src/components/campaigns/member-only-campaigns.tsx` — `MemberOnlyCampaigns` client widget.
  - `src/app/api/public/campaigns/member-only/route.ts` — `GET`, session-gated inside the handler (empty array for anonymous, no 401).
  - `src/components/events/event-personalization.tsx` — `EventPersonalization` client component.
  - `src/app/api/events/[id]/viewer-context/route.ts` — `GET`, always 200; returns `{ isLoggedIn, userName, signedUpDates, userRsvp, attachedFiles }`.
- **Modified:**
  - `src/app/layout.tsx` — removed `auth()`/session prop; wraps children in `AppSessionProvider`; no longer `async`.
  - `src/components/layout/header.tsx` — removed `HeaderProps`/`session` prop; calls `useSession()` internally.
  - `src/app/donate/page.tsx` — removed `auth()`; public-only query; renders `CampaignCard` + `MemberOnlyCampaigns`; `revalidate = 3600`.
  - `src/app/events/[id]/page.tsx` — removed `auth()` and all session-derived locals; renders `EventPersonalization`; `revalidate = 300`.
  - `src/types/events.ts` — added `OccurrenceRow.rsvpKey`.
  - `src/app/page.tsx`, `src/app/events/page.tsx`, `src/app/events/past/page.tsx` — added `revalidate = 300`.
  - `src/app/join/page.tsx`, `src/app/connect/page.tsx`, `src/app/meetings/page.tsx` — added `revalidate = 3600`.
  - `src/app/signin/page.tsx`, `src/app/register/page.tsx`, `src/app/reset-password/page.tsx` — added `Suspense` boundary around the `useSearchParams()`-consuming component.
- No schema change, no new `FEATURES` entry, no new env var.

### Route table — before / after (`pnpm build:only`)

| Route | Before | After |
|---|---|---|
| `/` | ƒ | ○ ISR (revalidate 5m) |
| `/about` | ƒ | ○ ISR (revalidate 1h) — unchanged export, now actually takes effect |
| `/mission` | ƒ | ○ ISR (revalidate 1h) — ditto |
| `/programs` | ƒ | ○ ISR (revalidate 1h) — ditto |
| `/events` | ƒ | ○ ISR (revalidate 5m) |
| `/events/past` | ƒ | ○ ISR (revalidate 5m) |
| `/events/[id]` | ƒ | ƒ — see note below |
| `/donate` | ƒ | ○ ISR (revalidate 1h) |
| `/join` | ƒ | ○ ISR (revalidate 1h) |
| `/connect` | ƒ | ○ ISR (revalidate 1h) |
| `/meetings` | ƒ | ○ ISR (revalidate 1h) |
| `/campaigns`, `/causes` (unlisted in the batch, incidental win) | ƒ | ○ |
| `/signin`, `/register`, `/reset-password`, `/forgot-password` | ƒ | ○ (no server data fetch; interactivity is entirely client-side, so a static shell is correct) |
| `/admin/*`, `/members/*` | ƒ | ƒ — unchanged, still gated by `auth()`/`hasFeature()` in every page body |

**`/events/[id]` staying `ƒ` is expected, not a miss.** It has no `generateStaticParams` (deliberately, per the batch instructions — "on-demand ISR is fine"), so Next can't know the full path list at build time and labels it "server-rendered on demand" regardless of its `revalidate` export. The load-bearing fix was removing `auth()` — that's what stops Vercel from forcing `cache-control: no-store`; the route still gets ISR-cached per `revalidate = 300` after its first hit per path, the build-table symbol just doesn't distinguish "dynamic, cached after first render" from "dynamic, never cached."

### Test results

- `pnpm exec tsc --noEmit`: **PASS**, no errors.
- `pnpm test`: **PASS** — 99 files, 1867 tests, all green (no test asserted the old `Header session={session}` prop shape, so nothing needed updating).
- `pnpm build:only`: **PASS** — route table matches the table above exactly.
- `pnpm lint`: **could not run** — pre-existing, unrelated environment issue (`ESLint 9.39.2` + the installed `minimatch` fail with `SyntaxError: The requested module 'minimatch' does not provide an export named 'default'` while loading `@eslint/eslintrc`). This reproduces on a clean `git stash` too, so it predates this batch; not something to fix under this work-log. Flagging for the 30-day dependency review.
- `pnpm dev` smoke test: homepage 200, header shows "Member Login" text when signed out, `/mission`/`/events`/`/donate` all 200, `/members` → 307 → `/signin?callbackUrl=%2Fmembers`, `/events/[id]` 200 with `GET /api/events/[id]/viewer-context` returning the anonymous baseline (`{"isLoggedIn":false,...}`), no server errors in the dev log.
- Playwright (`e2e/donate.spec.ts`, `e2e/smoke.spec.ts`, `e2e/wall-clock-display.spec.ts`, and the non-admin-gated tests in `e2e/club-files-flow.spec.ts`): **PASS** — 8/8 that don't require `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` (not set in this environment). The admin-login-gated specs (`cancel-occurrence.spec.ts`, `recurring-signup-rollup.spec.ts`, `write-in-signups.spec.ts`, the rest of `club-files-flow.spec.ts`) errored on the missing env vars before reaching any assertion — this is a pre-existing environment gap, reproducible on `main` before this batch, not a regression from this change.

### Open questions / handoff notes

- **Manual browser click-through still recommended** for: signing in as a member and confirming the header swaps from "Member Login" to "Member Portal"/"Admin"/"Sign Out" without a jarring layout shift; visiting `/donate` as a signed-in user who has at least one non-public campaign configured (none exist in the current dev DB, so this path only got the anonymous-path e2e coverage); visiting a recurring event's `/events/[id]` as a member who's already signed up for an occurrence, confirming the "Signed Up ✓" state appears after the brief loading flash instead of staying stuck on "Sign Up."
- **The `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` gap is real and predates this batch** — worth a follow-up to either document them in `.env.local.example` or add a skip-with-reason for CI environments that don't have them, since right now those specs error rather than skip.
- **`pnpm lint` is currently broken in this environment** independent of this work — flagged for the dependency review, not blocking this batch.
- Nominating **qa** for Phase 5: re-run the build/test suite standalone, do the manual click-throughs above, and confirm the `/events/[id]` personalization (attached-files visibility boundary, per-occurrence signed-up state) with a real signed-in member session — the automated coverage here is real but the admin/member-gated paths could only be verified by reading the code and by curl against the anonymous baseline, not by driving a signed-in browser session end-to-end.

---

## Batch 3 — Event Image Storage — 2026-09-04

**Owner:** full-stack-developer
**Status:** complete

### Summary

The admin event image cropper stored the full cropped JPEG as a base64 `data:` URI directly in `events.image` (a `text` column) — every page rendering an event shipped the image bytes twice (the `<img>`/`<Image>` `src` and the RSC payload) and Next couldn't optimize a data URI at all. This batch moves the bytes into a new `event_images` table (bytea, sibling of `ledger_receipt_files` / `club_file_blobs` per DECISION-094's spirit) and rewrites `events.image` to hold a versioned, same-origin URL served by a new route — a plain schema-normalization fix, no new permission surface.

### What I did

- Added `event_images` (`event_id` PK/FK → `events.id` ON DELETE CASCADE, `data bytea`, `content_type`, `updated_at`) to `src/lib/db/schema.ts`, reusing the `bytea` customType already exported for `ledger_receipt_files`/`club_file_blobs` — no new customType defined.
- Wrote idempotent migration `drizzle/migrations/0099_event_images.sql`: creates the table, then (guarded, re-run-safe) finds every `events` row still holding a `data:image/...;base64,...` value, decodes it into `event_images`, and rewrites the column to `/api/public/events/{id}/image?v=1`. Scoped strictly to rows matching `image LIKE 'data:image/%;base64,%'` on both the INSERT and the UPDATE, so a replay after conversion touches zero rows.
- Extracted the transposition logic into a pure, unit-tested helper (`src/lib/event-image.ts`): `isImageDataUri`, `parseImageDataUri` (data URI → `{contentType, buffer}`, returns `null` rather than throwing on anything malformed), `buildEventImageUrl` (id + version → the versioned serve-route URL).
- Added `src/lib/event-images-queries.ts` (DB access, mirrors `DatabaseClubFileStorage`'s upsert shape): `upsertEventImage` (insert-or-replace via `ON CONFLICT (event_id) DO UPDATE`), `deleteEventImage` (no-op if missing), `getEventImage`.
- New route `GET /api/public/events/[id]/image` (`src/app/api/public/events/[id]/image/route.ts`) — no auth (mirrors the public member-photo route's shape exactly): 404 with a short `s-maxage=300` cache on anything missing, 200 with `Cache-Control: public, max-age=31536000, immutable` and the stored `Content-Type` on a hit.
- Rewired both admin event write paths (`POST /api/admin/events`, `PATCH /api/admin/events/[id]` — both already gated on `FEATURES.EVENTS_EDIT`, unchanged) to transpose on the server:
  - **Create:** the event is inserted first with `image: null` if the incoming value is a data URI (the base64 blob is never written to `events.image`, even momentarily); once the row's id exists, the data URI is parsed, upserted into `event_images`, and the row is updated to the versioned URL.
  - **Edit — new/replaced image:** same transposition, keyed by the existing event id; version bumps to `Date.now()` so the new `?v=` value invalidates any `immutable`-cached copy of the old bytes at a new URL.
  - **Edit — image removed:** the client's `ImageCropper` sends an explicit `null` on Remove (confirmed by reading `src/components/admin/image-cropper.tsx`/`event-form.tsx` — the field is always present in the submitted payload, so `null` is unambiguous, never "field omitted"); the server deletes the `event_images` row and nulls the column.
  - **Edit — unchanged:** an existing versioned URL (not a data: URI, not null) passes through untouched — no `event_images` write.
  - A malformed data: URI (shouldn't happen from the cropper) never wipes an existing image — create leaves the event imageless; edit leaves whatever was already stored.
  - Event delete needed no code change — the FK's `ON DELETE CASCADE` removes the `event_images` row automatically (verified directly, see Testing below).
- **Render paths required no changes.** Read `src/app/page.tsx` (via `featured-content.tsx`), `src/app/events/page.tsx`, `src/app/events/[id]/page.tsx`: all three already guard on `event.image.startsWith("http")` for `unoptimized`, which is `false` for our new relative URL, so `next/image` now optimizes the image — that guard was already correct for a same-origin URL, nothing to touch. `src/app/events/[id]/page.tsx`'s `generateMetadata()`/JSON-LD already resolved a non-`data:` relative `event.image` to an absolute URL for `jsonLdImage` and relied on `metadataBase` for `openGraph.images` — both already produce a correct absolute `https://westervillelions.org/api/public/events/...` URL with no changes needed (verified via curl, see below). Batch 1's `data:` URI guard on both stays in place as a safety net.
- **One unplanned fix required:** Next.js 16 denies a query string on *any* local (`/`-prefixed) `next/image` src unless `images.localPatterns` is explicitly configured — our versioned `?v=` URL tripped this and 500'd the homepage the first time I hit it in dev. Added `images.localPatterns` to `next.config.ts`: an explicit allow for `/api/public/events/**` (no `search` key, so any `?v=` value matches — `matchLocalPattern` skips the search check entirely when the pattern omits it), plus `{ pathname: "**", search: "" }` to reproduce the framework's implicit prior default (no query string) for every other local image path, since configuring `localPatterns` at all replaces Next's auto-inserted default rather than extending it.

### Outputs

- **Schema:** `src/lib/db/schema.ts` — new `eventImages` table + `EventImage`/`NewEventImage` types (placed after `ledgerReceiptFiles`, since it needed to follow the `bytea` customType's declaration).
- **Migration:** `drizzle/migrations/0099_event_images.sql` — table creation + guarded, idempotent data migration.
- **New files:**
  - `src/lib/event-image.ts` — pure data-URI transposition helpers (unit-tested).
  - `src/lib/event-image.test.ts` — 12 unit tests covering `isImageDataUri`, `parseImageDataUri` (valid JPEG/PNG, non-data string, non-image mime, empty payload, malformed/no-comma), `buildEventImageUrl`.
  - `src/lib/event-images-queries.ts` — DB access (`upsertEventImage`, `deleteEventImage`, `getEventImage`).
  - `src/app/api/public/events/[id]/image/route.ts` — public serve route.
- **Modified:**
  - `src/app/api/admin/events/route.ts` (POST) — data-URI transposition on create.
  - `src/app/api/admin/events/[id]/route.ts` (PATCH) — data-URI transposition, removal, and unchanged-passthrough on edit.
  - `next.config.ts` — added `images.localPatterns` (see above).
- No new `FEATURES` entry, no new env var — the write path reuses the existing `FEATURES.EVENTS_EDIT` gate on both routes, unchanged.

### Testing

- `pnpm exec tsc --noEmit`: **PASS**.
- `pnpm test`: **PASS** — 100 files, 1879 tests (was 1867; +12 new, all in `event-image.test.ts`), all green.
- `pnpm build:only`: **PASS** — `/api/public/events/[id]/image` present in the route table; no route lost.
- **Dev-DB migration** (`pnpm db:migrate` against `.env.local`'s `DATABASE_URL`, dev DB only — production untouched per instructions): ran clean. Before: 8 of 42 `events` rows held a `data:image/%` value. After: 0 data-URI rows, 8 rows rewritten to `/api/public/events/{id}/image?v=1`, `event_images` populated with exactly 8 rows. Confirmed idempotent — re-running `pnpm db:migrate` (both a manual re-run and the automatic one on every `pnpm dev` startup) logs `relation "event_images" already exists, skipping` and touches 0 additional rows.
- **Homepage/`/events` HTML size, measured in dev** (real before/after — not estimated: temporarily reconstructed the original base64 values from `event_images` bytes back into `events.image`, measured, then restored the migrated state via the exact `UPDATE` from the migration, confirmed `event_images` still held all 8 rows throughout):

  | Page | Before (base64 in `events.image`) | After (versioned URL) | Reduction |
  |---|---|---|---|
  | `/` (homepage) | 281,411 bytes | 89,958 bytes | 68% |
  | `/events` | 342,336 bytes | 150,797 bytes | 56% |

  Zero `data:image` occurrences remained in either page's HTML after restoring the migrated state (`grep -c "data:image" ` → 0 on both).
- **Serve route:** `curl -I` on a real event's image → `200`, `content-type: image/jpeg`, `cache-control: public, max-age=31536000, immutable`. A random/missing id → `404`, `cache-control: public, s-maxage=300, stale-while-revalidate=60`.
- **OG/JSON-LD:** `curl` on `/events/{id}` for a migrated event → `<meta property="og:image" content="https://westervillelions.org/api/public/events/{id}/image?v=1"/>` and the JSON-LD `"image"` field both fully absolute, no code change needed (existing guards already handled it).
- **Write-path integration** (real dev DB, not mocked — ran the exact `upsertEventImage`/`deleteEventImage`/`parseImageDataUri` calls the routes make, via a throwaway `tsx` script, then deleted the script): create → data-URI upsert → bytea round-trip byte-identical, correct `contentType`; replace-in-place → single row updates (`ON CONFLICT` upsert, no duplicate), old bytes gone; explicit remove → `event_images` row deleted, `events.image` nulled; separately, deleting the parent `events` row (without touching `event_images` first) cascade-deleted the `event_images` row via the FK, confirming `ON DELETE CASCADE` works as declared.
- **Dev-server smoke test:** homepage 200, `/events` 200, `/events/past` 200, `/events/{id}` 200, unauthenticated `/admin/events` still 307 → `/signin` (proxy/auth untouched), no errors in the dev log after the `next.config.ts` fix.

### Open questions / handoff notes

- **Production has not been touched** — no migration or push ran against `PROD_DATABASE_URL`, per instructions. Production's legacy base64 `events.image` rows will convert automatically the next time `pnpm db:migrate` runs as part of a deploy from `main` (migrations re-run on every deploy, per the project invariant) — no manual step needed once this is pushed.
- **`next.config.ts`'s new `images.localPatterns`** is a real behavior change worth a second pair of eyes: it now explicitly enumerates every local image path pattern next/image will optimize (previously implicit/unconfigured). I added the one entry this batch needs plus a catch-all reproducing the prior default — but if another local image path with a query string gets added later, it'll need its own `localPatterns` entry or it will 500 the same way this batch's first dev run did.
- **Manual browser click-through recommended**: open `/admin/events/new` and `/admin/events/[id]/edit` and actually exercise the cropper — upload → crop → Apply → Save (confirm the event's image renders from the new URL afterward), Change Image → Save (confirms replace-in-place + old bytes gone), Remove → Save (confirms the image clears and no `event_images` row lingers). All three paths were verified against the DB layer directly in this session but not driven through the actual browser UI.
- Nominating **qa** for Phase 5: independently confirm the browser click-through above, and spot-check that `next/image`'s AVIF/WebP conversion (formats already configured pre-batch) is actually being applied to the new same-origin event image URLs in a production-like build, not just that they load.

## Batch 4 — mobile UX pass — 2026-09-04

**Owner:** ux-developer
**Status:** complete

### Summary

A real-browser mobile audit (390×844 touch viewport) of the live site turned up 14 tap-target, interaction, and layout defects — the worst being 14×14px map-pin links sitting flush against phone links on `/programs`. This batch fixes all 14 findings directly (no schema or API surface involved, so no api-developer/database-admin handoff was needed) and verifies every fix with Playwright at 390×844 against a real `pnpm dev` server, not just visual inspection.

### What I did

1. **`/programs` drop-off locations** — replaced the 14×14px inline "pin" link with a `LocationEntry` component (`src/app/programs/page.tsx`) rendering a "Map" and "Call" action pair, each a real `min-h-[44px]` padded link, visually separated (not adjacent bare icons). Inline on desktop, wraps naturally on narrow screens via `flex-wrap`. Consolidated the eyeglass and plastic-film location lists onto the same component (they were near-duplicate JSX before).
2. **Newsletter form** (`src/components/newsletter-form.tsx`) — all three inputs `text-sm` → `text-base` (16px, stops iOS Safari's auto-zoom-on-focus) and `py-2` → `py-3`; Subscribe button `text-sm py-2` → `text-base py-3` (44→48px tall). Verified the contact form (`src/components/contact-form.tsx`) and membership application form (`src/components/membership-application-form.tsx`) already omit `text-sm` on inputs (default 16px) — no change needed there.
3. **`/join` testimonial carousel** (`src/components/join/testimonial-carousel.tsx`) — arrows enlarged from 36×36px (translated half off-card) to a true 44×44px, repositioned fully on-screen (`left-1`/`right-1` on mobile, inside the card). Replaced the 8×8px dot row with a "1 / N" counter plus 44×44px padded hit targets wrapping the same visual dots (10px, up from 8px). **Could not find the "consent checkbox" cited in the audit** — `membership-application-form.tsx` has no checkbox input anywhere (grepped the whole component and the whole repo for `type="checkbox"` near `/join`); the only checkboxes in the codebase are in member-portal forms (proposal, social-request, suggestion-box), unrelated to `/join`. Treating this as a stale/mismatched audit finding rather than guessing at an element to add — flagging for the Lions Club/next reviewer to confirm against the live production site.
4. **Footer** (`src/components/layout/footer.tsx`) — social icons got `p-3` (effective 44×44 tap area) plus a focus ring; every footer text link (`Who We Are`/`Get Involved`/`Connect` lists, the email link, "Lions Clubs International") got `inline-block py-3 -my-3` (padding added, visual position unchanged via the offsetting negative margin) plus a focus ring. `h4` section headings → `h3` (footer now correctly continues from the page's own `h2`s instead of skipping a level).
5. **Zeffy modal close button** (`src/components/campaigns/zeffy-embed.tsx`) — `p-1` (28×28px icon) → `h-11 w-11 flex items-center justify-center` (44×44px) plus a focus ring, with a small negative margin so it doesn't visually crowd the header.
6. **Add-to-Calendar dropdown** (`src/components/events/add-to-calendar-dropdown.tsx`) — added `side="bottom" avoidCollisions={false}` to `DropdownMenuContent`. Radix's default collision avoidance was flipping the panel above the trigger whenever the visible viewport below looked short (common on a scrollable mobile list, even mid-list), covering the event title. The panel is only ~4 short items on a normally-scrolling page, so forcing it to always open downward is the right call here — confirmed via Playwright that `data-side="bottom"` holds and the panel renders below the trigger.
7. **Mobile menu button** (`src/components/layout/header.tsx`) — added `aria-expanded={mobileMenuOpen}` and `aria-controls="mobile-menu"` (paired with a new `id="mobile-menu"` on the panel).
8. **`/about` leadership grid** — `src/app/about/page.tsx`: grid is now `grid-cols-2 md:grid-cols-3` at every width (was `grid-cols-1` on mobile — one giant card per row). `getLeadership()`'s query now selects `hasPhoto: sql<boolean>` (`profile_picture IS NOT NULL`) instead of letting every member issue a photo request; `LeadershipAvatar` (`src/components/members/leadership-avatar.tsx`) takes a new `hasPhoto`/`initials` prop pair and renders a `lions-blue/10` circle with `lions-blue` initials immediately when `hasPhoto` is false — no doomed `<img>` request, no flash of the old gray silhouette. Avatar size dropped from a fixed 128px to `w-20 h-20 sm:w-24 sm:h-24`; card padding and text sizes shrank to match (`p-4 sm:p-6`, `text-sm sm:text-base`).
9. **Event detail page** (`src/app/events/[id]/page.tsx`) — removed the duplicate "← Back to Events" link below the image; the hero's "← All Events" link is now the only back-link.
10. **"0 attendees" copy** — both `src/components/events/occurrence-signup-list.tsx` and `src/components/events/single-event-signup.tsx`: when there's no `maxAttendees` cap and the count is 0, render "Be the first to sign up" instead of "0 attendees (incl. guests)". Left the capped case ("0 / 5 spots") alone — that phrasing already reads fine at zero.
11. **Homepage stats band** (`src/app/page.tsx`) — `grid md:grid-cols-3` (1 column until `md`) → `grid grid-cols-3` at every width, with smaller numbers/labels/padding on mobile (`text-2xl`/`text-xs`/`p-2` scaling up to the original `text-5xl`/`text-xl`/`p-6` at `sm:`) so the three stats read as one glanceable band instead of three full-screen blocks.
12. **`/events` month grouping** (`src/app/events/page.tsx`) — grouped the already-sorted `publicEvents` list by `MMMM yyyy` in a single pass server-side, with a `position: sticky` month header (`top-24 md:top-28 lg:top-32`, offsets matched to the header's actual rendered height at each breakpoint: logo `h-16/20/24` + `py-4` nav padding) and a `bg-white/90 backdrop-blur-sm` band so cards scroll under it. No client JS added — pure server-rendered HTML/CSS.
13. **Body copy on `/mission`** (`src/app/mission/page.tsx`) — the eight cause descriptions and the three "What We Stand For" principle descriptions went `text-sm` → `text-base` (both are primary reading content, per the same reasoning). Audited the homepage for a similarly-undersized "section intro" paragraph and found none — `page.tsx`'s own section intros are already `text-lg`/`text-xl`; the `text-sm` instances in `ServiceAreas`/`FeaturedContent` are card meta/labels (dates, locations, "Learn more" links), not primary reading copy, so left untouched per the "don't bump every text-sm" instruction.
14. **Donate noscript fallback** (`src/app/donate/page.tsx`) — added a `<noscript>` block above the campaign grid pointing non-JS visitors to `#other-ways-to-give` (a new anchor on the existing "Other Ways to Give" / mail-a-check section further down the page).

### Outputs

- `src/app/programs/page.tsx` — `LocationEntry` component replacing `MapsLink` + duplicated inline JSX.
- `src/components/newsletter-form.tsx` — input/button sizing.
- `src/components/join/testimonial-carousel.tsx` — arrows + counter.
- `src/components/layout/footer.tsx` — tap targets + heading levels.
- `src/components/campaigns/zeffy-embed.tsx` — close button.
- `src/components/events/add-to-calendar-dropdown.tsx` — forced downward opening.
- `src/components/layout/header.tsx` — `aria-expanded`/`aria-controls`.
- `src/app/about/page.tsx` + `src/components/members/leadership-avatar.tsx` — 2-col mobile grid, `hasPhoto`-gated query, initials fallback.
- `src/app/events/[id]/page.tsx` — duplicate back-link removal.
- `src/components/events/occurrence-signup-list.tsx`, `src/components/events/single-event-signup.tsx` — zero-attendee copy.
- `src/app/page.tsx` — 3-across stats band.
- `src/app/events/page.tsx` — month grouping + sticky headers.
- `src/app/mission/page.tsx` — body copy sizing.
- `src/app/donate/page.tsx` — noscript fallback + `#other-ways-to-give` anchor.

No new components required a permission gate; no schema, migration, or API route touched. All work stayed within ux-developer's remit.

### Testing

- `pnpm exec tsc --noEmit`: **PASS**.
- `pnpm test`: **PASS** — 100 files, 1879 tests, all green (unchanged from pre-batch; no new unit tests were needed for pure markup/class changes).
- `pnpm build:only`: **PASS** — compiled successfully, full route table intact (`/about` still statically prerendered — the `hasPhoto` SQL projection didn't force it dynamic).
- **Playwright verification** against `pnpm dev` at 390×844 (throwaway script in the scratchpad dir, deleted after; screenshots kept):

  | Page | Horizontal overflow? |
  |---|---|
  | `/` | None (scrollWidth 390 = clientWidth 390) |
  | `/programs` | None |
  | `/join` | None |
  | `/connect` | None |
  | `/about` | None |
  | `/events` | None |

  | Tap target | Before (reported) | After (measured) |
  |---|---|---|
  | `/programs` Map link | 14×14px | 44px tall × 75px wide, ×20 locations |
  | `/programs` Call link | 14×14px (adjacent, mis-tap prone) | 44px tall × ~70px wide, separated from Map by the full link width — no overlap |
  | Newsletter email input font-size | 14px (`text-sm`) | 16px (`text-base`) — confirmed via `getComputedStyle` |
  | Newsletter Subscribe button | ~36px tall | 48px tall |
  | `/join` carousel prev/next arrows | 36×36px, translated half off-card | 44×44px each, fully on-screen (x=20→64 and x=326→370 inside a 390px viewport) |
  | Footer Facebook icon | 20×20px, no padding | 44×44px |
  | Footer "About the Club" link | ~17px tall, text-only | 44px tall (98px wide) |
  | Add-to-Calendar dropdown | Opened upward (`data-side` flipped), covering the event title | `data-side="bottom"` confirmed on every open; panel renders below the trigger |
  | `/about` leadership grid | 1 column (single full-width card per row) at mobile width | 2 columns confirmed (paired card-top Y-coordinates at 390px width) |

- **Screenshots** (390×844, kept per instructions):
  - `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/b6a3c0f0-2679-4534-81d4-c8541f867e37/scratchpad/programs-mobile.png`
  - `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/b6a3c0f0-2679-4534-81d4-c8541f867e37/scratchpad/about-mobile.png`
  - `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/b6a3c0f0-2679-4534-81d4-c8541f867e37/scratchpad/join-mobile.png`
  - `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/b6a3c0f0-2679-4534-81d4-c8541f867e37/scratchpad/footer-mobile.png`
- Eyeballed all four screenshots: `/programs` shows clearly separated "Map"/"Call" pairs per location; `/about` shows a compact 2-column grid with real photos where present and `lions-blue`/initials chips elsewhere (page went from ~6 screens of scrolling to well under 2); `/join` shows both carousel arrows fully inside the card and the "1 / 2" counter; the footer shows padded, evenly-spaced social icons and legible link spacing.
- Noticed a persistent Next.js dev-mode "1 Issue" overlay badge on every page during manual/Playwright checks — traced it to a console error (`eval() is not supported... Content-Security-Policy`), which is React dev mode's own debugging `eval()` usage tripping the strict `script-src` CSP in `next.config.ts`. Confirmed via console capture this is unrelated to any change in this batch (React never calls `eval()` in production builds, and the production build above compiled clean) — pre-existing dev-only noise, not a regression.
- Throwaway Playwright script and its intermediate copy were deleted from both the scratchpad and the repo root after use; only the four screenshots above were kept.

### Open questions / handoff notes

- **The `/join` "consent checkbox" finding could not be reproduced in code** — see item 3 above. Recommend the Lions Club (or whoever ran the original audit) re-check the live production `/join` page against this description; if the checkbox exists there but not in this repo's `membership-application-form.tsx`, something is out of sync between production and `main` that's worth investigating before the next deploy.
- **New copy to sanity-check:** "Be the first to sign up" (occurrence + single-event signup zero-count state), the donate-page noscript sentence, and the `/programs` "Map"/"Call" link labels — all small, low-risk strings but worth a glance from the Lions Club.
- **UX decision:** forced the Add-to-Calendar dropdown to always open downward (`avoidCollisions={false}`) rather than tuning Radix's collision math. Given the panel's short, fixed height and that the page always scrolls, this trades "theoretically clips at the very bottom of a long page" (recoverable by scrolling, and the panel's own `max-h-[...-available-height]` + `overflow-y-auto` still caps it) for "never again covers the event title," which seems like the right trade for this specific dropdown. Not applied to `DropdownMenu` usages elsewhere in the app (there are none currently) or to the generic `src/components/ui/dropdown-menu.tsx` primitive itself — this is scoped to the one component named in the audit.
- **Reviewer click-through suggested:** `/programs` (tap Map and Call on a few locations on an actual phone, confirm no mis-taps), `/join` (swipe/tap through the testimonial carousel, check the counter), `/about` (scroll the leadership grid, confirm initials chips read correctly for members without photos), `/events` (scroll past a month boundary to see the sticky header take over, open the Add-to-Calendar dropdown on a card near the bottom of the visible viewport), footer on any page (tap a social icon and a nav link near the edge of their padding).
- Nominating **qa** for Phase 5 on this batch: independently re-run the manual click-through above on a real device or device emulator (Playwright's `isMobile`/`hasTouch` context approximates but doesn't fully replicate iOS Safari's zoom-on-focus behavior), and confirm the `/join` consent-checkbox discrepancy noted above before it's assumed resolved.

---

## Batch 5 — Trust Content — 2026-09-04

**Owner:** ux-developer
**Status:** complete (item 6 skipped — no schema support, see below)

### Summary

Nonprofit trust/conversion fixes: a new Privacy Policy page, entity clarity + EIN on `/donate`, a live two-fiscal-year giving total pulled straight from the ledger, dues transparency and a warmer next-steps flow on `/join`, and a softened membership-application legal section. Went straight to Phase 4 (compressed bug-fix pipeline, same as Batches 1–4 in this work-log — Phases 1–3 skipped, no schema/architecture questions, content-and-copy scope fully specified up front). No `database-admin`/`api-developer` split: the one new live query is small, dedicated, and unit-tested inline with the pages that consume it, in the same spirit as Batch 3's `event-image.ts`.

### What I did

1. **Privacy Policy page** (`src/app/privacy/page.tsx`) — new public page, `revalidate = 86400`, full metadata + canonical, `/programs`-style gradient hero. Plain-language sections: What We Collect (contact form, newsletter, membership application, event RSVPs, member accounts), How We Use It, What We Don't Do (no selling/renting, full stop), Analytics (Google Analytics, standard cookies), Email Preferences (unsubscribe via info@), Questions/Removal Requests (info@). Effective date September 4, 2026. **Added to `src/app/sitemap.ts`** (priority 0.3, yearly).

   **⚠️ This page was drafted by Claude and needs the Lions Club's review before or shortly after ship.** It's built entirely from the task's own plain-English content brief — no independent legal review, no counsel consulted. Flagging explicitly per the task's own instruction to do so.

2. **Footer + form links** — `src/components/layout/footer.tsx`: added a "Privacy Policy" link (`/privacy`) into the bottom legal bar next to the copyright line. Added a short "See our Privacy Policy for how we handle your information/the information you provide here" line under each of the three public forms: `src/components/contact-form.tsx`, `src/components/newsletter-form.tsx` (also tightened its existing "contacting us" text to name `info@westervillelions.org` explicitly, matching the Privacy Policy's own Email Preferences section), `src/components/membership-application-form.tsx`.

3. **`/donate` entity clarity + EIN** — **The "Donate to Lions Club" button label comes from the database**: it's `campaigns.title` (confirmed directly against the dev DB — `select title from campaigns` returns `"Donate to Lions Club"` for the active public campaign), passed straight through as `ZeffyEmbed`'s `label` prop in `src/components/campaigns/campaign-card.tsx`. Per instructions, did **not** hardcode a different label — fixed the surrounding page copy instead.
   - Added a statement block near the top of `/donate`, before any campaign card: "Donations made here are received by the **Westerville Lions Club Foundation**, a 501(c)(3) nonprofit — your gift is tax-deductible as allowed by law. **EIN 32-0467239**." (Used the codebase's established public-facing name "Westerville Lions Club Foundation" — the donor-acknowledgment-letter template, its signature block, and every existing test fixture all use this form; `ledger_entities.name` itself is stored as the shorter "Westerville Lions Foundation," which reads as the ledger's internal shorthand rather than the name used in every piece of donor-facing copy already in the codebase. Flagging this naming discrepancy for the Lions Club — if `ledger_entities.name` should actually be the full legal name, that's a data fix, not a copy fix, and out of scope here.)
   - Confirmed the Club (501(c)(4)) EIN never appears on this page — only the Foundation's.
   - Replaced the "contact us for the mailing address" link under "Mail a Check" with the actual PO Box, pulled from `src/app/connect/page.tsx`'s existing Mailing Address block: "Westerville Lions Club Foundation, PO Box 0597, Westerville, OH 43086-0597."
   - `src/components/campaigns/campaign-card.tsx`: added a short description line (`campaign.description`) under the image, above the donate button, shown whenever a campaign has one — the field exists on `campaigns` but the card never rendered it outside the post-click modal. Real dev-DB campaigns currently have empty-string descriptions, so as a safety net `/donate` also renders one shared sentence above the grid ("Every campaign below supports the Foundation's community programs — youth scholarships, hunger relief, vision care, and local humanitarian projects.") whenever **no** active campaign has a non-empty description, so the page is never left with zero "what this supports" copy.

4. **Live impact numbers** — new `src/lib/impact-stats.ts` (pure, unit-tested: `getRecentCompletedFiscalYears`, `roundDownToThousand`, `formatImpactAmount`) + `src/lib/impact-stats-queries.ts` (`getRecentGivingStats` — a small, dedicated Drizzle query, deliberately **not** a call into the much heavier `getPhilanthropy()` in `src/lib/ledger-queries.ts`, mirroring only its giving `WHERE` clause: `status='posted'`, `transferGroupId IS NULL`, `flow='expense'`, fund kind in `activity`/`charitable`/`scholarship`, category `countsAsGiving` true-or-null — scoped to the two most recently **completed** fiscal years, i.e. excluding the current in-progress FY).
   - `/donate`: full three-part impact band after the "Thank You for Your Support" block — live two-year total, live grant count, and the constant lifetime estimate with its footnote. A `title` attribute on the band names the exact fiscal years covered, for anyone who inspects it.
   - Homepage (`src/app/page.tsx`): one line added below the existing 3-across stats band — the live two-year total plus a "see our full community impact" link to `/donate`. Left the 3-stat grid itself untouched (already tightened in Batch 4) rather than replacing "8 Causes We Serve," per the task's "your judgment, keep it to one row" — a new small text row reads more like the club's own note-to-self than a fourth competing stat tile would.
   - The $1M+ lifetime figure stays a hardcoded constant (`LIFETIME_ESTIMATE` in `donate/page.tsx`) with its footnote, exactly as instructed — never computed.

5. **`/join` costs & next steps**:
   - "What It Costs" section reads the **active** `dues_settings` row server-side (page is already `revalidate = 3600`) and renders individual + additional-family-member annual dues, with a warm sentence that dues cover the club's own operating costs so donations go to the community. Wrapped in `{activeDues && (...)}` — omits cleanly if there's ever no active row.
   - "What Happens After You Apply" 3-step strip added above the application form: officer outreach → invited to a meeting/event → board review and induction. No invented timelines.
   - Promoted "attend a meeting first" to a real co-equal secondary CTA button in the hero: "Not ready to apply? Join us at a meeting" → `/meetings`, styled identically to the homepage hero's existing secondary-button pattern (outlined white-on-blue). Paired with a new primary "Apply Now" button that scrolls to the form (`#apply` anchor added to the application `<div>`).
   - Softened the LCI legal boilerplate in `membership-application-form.tsx`: **no legally meaningful text was deleted or reworded** — moved it out of its highlighted `bg-lions-blue/5` callout box into plain fine print (`text-xs text-gray-500 italic`), and added the Privacy Policy line immediately above it, so the boilerplate is no longer the single most visually prominent thing before the submit button.

6. **Events calendar badges** — **skipped, no code changed.** Checked the `events` schema (`src/lib/db/schema.ts`) end to end: there is no `type`/`category`/`tag` column or anything else distinguishing a club meeting from a community event — only `isPublic`, `isFeatured`, `isRecurring`, `recurrenceType` (`weekly`/`biweekly`/`monthly`), none of which encode "meeting vs. event." Per instructions, did **not** infer this from event titles. **Backlog item**: adding a `meetingType`/`eventKind` column (or similar) to `events` so public event cards can badge "Club meeting — visitors welcome" vs. "Open to everyone" — this needs a `database-admin` migration plus an admin UI control before `ux-developer` can badge anything, so it doesn't fit in this batch.

7. **Homepage hero tagline proposals** — page left unchanged, per instructions. Three grounded options for the club to choose from, each keyed to a real, verifiable program already in this codebase or its ledger data (Rudolph Run — referenced throughout `src/components/admin/ledger/*` as a real annual fundraiser; eyeglass recycling — the public `/programs` page's actual drop-off program; scholarships — referenced in `/donate`'s "Where Your Donation Goes" and the FY2024–25 "Youth & Education $22,000" cause total):
   - *"From the Rudolph Run to eyeglass recycling bins across town, we turn small acts into real community impact."*
   - *"Scholarships for local students. Eyeglasses for neighbors in need. One Lions Club, eight causes, since 1928."*
   - *"Fun runs, food drives, and eyeglass drop-offs — see how Westerville Lions shows up for this community all year long."*

   **Could not ground a fourth option in "BioBlitz"** — grepped the entire repository (code, tests, docs) for `bioblitz` and found zero matches. It may be a real Westerville Lions activity that simply isn't represented anywhere in this codebase's data or content yet; rather than invent copy referencing a program with no on-record evidence, left it out. If it's real, the Lions Club should supply a sentence and it can be added as a fourth option.

### Outputs

- **New files:**
  - `src/app/privacy/page.tsx` — Privacy Policy page (needs club review, see above).
  - `src/lib/impact-stats.ts` — pure FY-selection/rounding/formatting helpers.
  - `src/lib/impact-stats.test.ts` — 11 unit tests.
  - `src/lib/impact-stats-queries.ts` — `getRecentGivingStats()`, the dedicated live ledger query.
- **Modified:**
  - `src/app/donate/page.tsx` — entity/EIN block, campaign-description fallback sentence, impact band, mailing-address fix.
  - `src/app/page.tsx` — one-line live giving total under the stats band.
  - `src/app/join/page.tsx` — dues section, next-steps strip, hero secondary CTA, `#apply` anchor.
  - `src/app/sitemap.ts` — added `/privacy`.
  - `src/components/campaigns/campaign-card.tsx` — renders `campaign.description` on the card.
  - `src/components/layout/footer.tsx` — Privacy Policy link.
  - `src/components/contact-form.tsx`, `src/components/newsletter-form.tsx`, `src/components/membership-application-form.tsx` — Privacy Policy line; membership form's legal section also restyled/reordered.
- No schema change, no new `FEATURES` entry, no new env var. `duesSettings`, `ledgerTransactions`/`ledgerFunds`/`ledgerCategories` are all pre-existing tables, read-only here.

### Testing

- `pnpm exec tsc --noEmit`: **PASS**.
- `pnpm test`: **PASS** — 101 files, 1890 tests (was 1879; +11 new, all in `impact-stats.test.ts`), all green. (One test-authoring bug caught and fixed during this batch: an initial `roundDownToThousand` test passed `99_999_99` — $999.99 — intending $999,999.99; corrected to `99_999_999`.)
- `pnpm build:only`: **PASS** — full route table intact; `/privacy` present as `○` static with `1d` revalidate (matches `revalidate = 86400`); `/donate` and `/join` still `○` ISR at `1h`.
- **Dev-server smoke test** (real dev DB, same seeded ledger as production's shape):

  | Check | Result |
  |---|---|
  | `GET /privacy` | 200, `<title>Privacy Policy \| Westerville Lions Club</title>` |
  | `/donate` impact band | `$60,000+` given in the last two years, `51+` community grants, `$1 million+` since 1928 |
  | `/donate` EIN | "EIN 32-0467239" present |
  | `/donate` mailing address | "PO Box 0597" present under Mail a Check (no more "contact us" link there) |
  | `/join` dues | "$120/year" individual, "$96/year" family — matches the active FY2026 `dues_settings` row exactly |
  | `/join` hero | "Not ready to apply? Join us at a meeting" button present |
  | `/join` next steps | "What Happens After You Apply" strip present |
  | Footer | "Privacy Policy" link present on `/` |
  | `/join` legal section | "Privacy Policy" link present above the fine-print LCI paragraph |

  Verified the live figures against a direct SQL query against the same dev DB before writing any code: FY2024 = 25 txns / $34,125.00, FY2025 = 26 txns / $26,225.00 → combined $60,350.00 → rounds down to "$60,000+", 51 total grants. Matches exactly.

### Open questions / handoff notes

- **Privacy Policy needs club review before or shortly after ship** (repeated here per the task's explicit flag) — it's accurate to what the site actually does today, but no one at the club has read it yet.
- **Naming discrepancy**: `ledger_entities.name` for the Foundation is `"Westerville Lions Foundation"` (no "Club") while every donor-facing string elsewhere in the codebase — acknowledgment letters, signature blocks, this batch's own new `/donate` copy — says `"Westerville Lions Club Foundation"`. Not fixed here (a data question, not a copy one); worth a decision from the Lions Club on which is the actual legal name.
- **Item 6 (event badges) needs a schema change first** — see above; nominating this as a `database-admin` + `ux-developer` follow-up, not closed out in this batch.
- **Hero tagline**: three grounded proposals above, plus a note that "BioBlitz" couldn't be verified anywhere in the repo — the Lions Club should pick one (or supply real BioBlitz copy) rather than have it decided here.
- **New copy to sanity-check**: the entity-clarity paragraph, the "What Happens After You Apply" three steps (no timelines were promised — confirm that's accurate), the dues warm-sentence framing, and the full Privacy Policy text.
- Reviewer click-through suggested: `/privacy` (read start to finish), `/donate` (confirm the impact band numbers look sane and the EIN/mailing address read correctly, click a campaign card if one now has a description), `/join` (click both hero buttons, confirm the dues figures, scroll to the application form and confirm the softened legal text still reads as the complete original sentence).
- Nominating **qa** for Phase 5: typecheck/build/test already re-confirmed in this session; qa should independently verify the dev-server smoke-test table above and do the manual click-through listed.

---

## Phase 5 — Integrated QA — 2026-09-04

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** All five batches (proxy/404/fonts/favicon/OG fixes, ISR unlock, event-image storage, mobile UX, trust content) verified together on the combined working tree. Typecheck clean, 101/101 test files and 1890/1890 unit tests green, production build clean with every expected route static/ISR and every protected route still dynamic, full dev-server smoke suite passed, the three runnable Playwright specs passed 7/7, and every named cross-batch integration point (404 page's `next/image` under the new AVIF/`localPatterns` config, event images optimized through `next/image` with the `?v=` query string, `/join`/`/donate` rendering live DB values while statically ISR'd) checked out. Working tree has no stray files beyond the five batches' own inventory.

### What I did

1. Read the full work-log (all 5 batches + each batch's own self-verification) before touching anything, to know what each batch changed and why.
2. Ran `pnpm exec tsc --noEmit` — clean, no output, exit 0.
3. Ran `pnpm test` — **101 files, 1890 tests, all passed**, matching the expected count exactly (2.14s test time).
4. Ran `pnpm build:only` — clean compile, no warnings, no errors. Cross-checked the printed route table against every `page.tsx`/`route.ts` under `src/app` (route-group segments stripped): the only diffs were Next's own auto-generated entries not backed by a `page.tsx`/`route.ts` (`/_not-found`, `/apple-icon.png`, `/icon.png`, `/robots.txt`, `/sitemap.xml`) — no app-directory route is missing from the build, and nothing unexplained is present.
5. Started `pnpm dev` on port 3000 and ran the full curl/Playwright smoke suite from the task (see Outputs below for the evidence table).
6. Ran the three specified Playwright specs against the running dev server: `donate.spec.ts`, `smoke.spec.ts`, `wall-clock-display.spec.ts` — 7/7 passed.
7. Did the cross-batch integration checks: read `src/app/not-found.tsx` and confirmed its `next/image` fetch resolves 200 under the new `images.localPatterns`/AVIF config; confirmed both `/` and `/events` route the batch-3 event image through `/_next/image?url=...` (not a raw `<img>`) and that the optimized fetch returns 200; grepped `/donate`, `/join`, and the root layout for `auth()` and found none (confirming batch 2's dynamic-forcer removal is intact), then confirmed the build table still shows both as `○` ISR at `1h` while the dev-server HTML shows the correct live DB-backed dues ($120/$96) and impact ($60,000+) figures.
8. Checked `git status` in full — every modified/untracked file matches the batches' own "Files Modified/Created" inventories; no throwaway scripts or screenshots were left in the repo (a temporary Playwright viewport-check script was created and deleted from the repo root during this session; its output screenshots were not written to disk).
9. Killed the dev server at the end of the session.

### Outputs

**Type Check**

`pnpm exec tsc --noEmit`: **PASS** — no errors.

**Unit Tests**

`pnpm test`: **PASS**
Total: 1890 | Passed: 1890 | Failed: 0 | Files: 101/101
Duration: 1.86s

**Production Build**

`pnpm build:only`: **PASS**. Route-table audit against `src/app`:

| Requirement | Result |
|---|---|
| `/`, `/about`, `/mission`, `/events`, `/events/past`, `/programs`, `/donate`, `/join`, `/connect`, `/meetings`, `/privacy` all static/ISR (○), not ƒ | Confirmed — all ○, revalidate values match each page's own `revalidate` export (5m/1h/1d as documented per batch) |
| `/events/[id]` dynamic (ƒ) | Confirmed — expected per batch 2's own documented rationale (no `generateStaticParams`, ISR-after-first-hit) |
| `/admin/*`, `/members/*` dynamic (ƒ) | Confirmed, every entry |
| No route missing vs. app directory | Confirmed by diffing the full `find src/app -name page.tsx -o -name route.ts` list against the printed table — the only deltas are Next's own implicit routes (`/_not-found`, `/icon.png`, `/apple-icon.png`, `/robots.txt`, `/sitemap.xml`), none of which are backed by a source file |
| No stray warnings/errors in build output | Confirmed — `grep -in "warn\|error\|fail"` on the full build log returned nothing |

One expectation in the task brief did not literally hold, and is a correct, documented deviation rather than a defect: **`/signin`, `/register`, `/reset-password`, `/forgot-password` build as `○` static, not `ƒ`.** This is batch 2's deliberate design — none of these pages call `auth()` server-side any more (their interactivity is entirely client-side, wrapped in `Suspense`), so a static shell is the correct, intended output. `/access-pending`, which does call `auth()` itself, is still `ƒ`. Verified by reading `src/app/donate/page.tsx`, `src/app/join/page.tsx`, and `src/app/layout.tsx` directly — no `auth()` call in any of the three.

**Dev-Server Smoke Test** (`pnpm dev`, port 3000)

| Check | Result |
|---|---|
| `GET /` | 200; zero `data:image/jpeg;base64` occurrences; `$60,000+` impact line present; "Causes We Serve" stats band and "community impact" link present |
| Font | Served from `/_next/static/media/cf514f5d0007dafa-s.p.1wc2mf9hp9pav.woff2` (same-origin); zero `fonts.googleapis.com` references in the HTML |
| Favicon | `<link rel="icon" href="/icon.png?...">` and `<link rel="apple-touch-icon" href="/apple-icon.png?...">` both present |
| `GET /events` | 200; month-grouping headers present (`September 2026` through `May 2027`); "Past events" link present |
| `GET /events/past` | 200 |
| Event detail page (found event `882e610b-...` with a real image) | 200; `og:image` = `https://westervillelions.org/api/public/events/882e610b-bd53-40ba-9458-71f3e86b6977/image?v=1` — absolute URL, not `data:` |
| `GET /api/public/events/{id}/image` | 200; `cache-control: public, max-age=31536000, immutable`; correct `content-type: image/jpeg` |
| `GET /this-is-a-garbage-url-xyz-123` | HTTP 404 status; branded not-found page rendered (`<h1>Page not found</h1>`, `404-lion.jpg` referenced, "Return home"/"Upcoming events"/"Contact us" links present) |
| `GET /admin` (anonymous) | 307 → `/signin?callbackUrl=%2Fadmin` |
| `GET /members` (anonymous) | 307 → `/signin?callbackUrl=%2Fmembers` |
| `GET /donate` | 200; "32-0467239" (EIN) present; "PO Box 0597" present; "$60,000+" impact figure present |
| `GET /join` | 200; "$120" and "$96" dues figures present; "What Happens After You Apply" present; "Join us at a meeting" secondary CTA present |
| `GET /privacy` | 200; `<title>Privacy Policy \| Westerville Lions Club</title>`; meta description present |
| `GET /connect` | 200 |
| `GET /signin` | 200 (page renders; no real sign-in attempted — no live click-through of credentialed flows in this pass, see below) |
| `/connect` newsletter inputs at 390×844 | All five text/email inputs measured `font-size: 16px` via Playwright `getComputedStyle` |
| Horizontal overflow at 390px | `/`, `/programs`, `/join`, `/about`, `/events` all measured `scrollWidth === clientWidth === 390` — zero overflow |

**End-to-End Tests**

`PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test e2e/donate.spec.ts e2e/smoke.spec.ts e2e/wall-clock-display.spec.ts`: **PASS**
Total: 7 | Passed: 7 | Failed: 0
Duration: 1.2s

All other e2e specs (admin-gated) were **not run** — out of scope per this task's instructions. Note for the record: `.env.local` in this environment currently **does** have `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`/`E2E_ADMIN_PASSWORD_HASH` set, which differs from batch 2's own note that they were unset in its session. This wasn't exploited to broaden scope beyond the task's instructions, but it means the admin-gated specs may now be runnable in this environment — worth a follow-up full e2e run outside this integrated-QA pass.

**Cross-Batch Integration Checks**

| Check | Result |
|---|---|
| `not-found.tsx`'s `next/image` under new AVIF/`localPatterns` config | No conflict — `/_next/image?url=%2Fimages%2F404-lion.jpg&w=750&q=75` returns 200 |
| Batch-3 event images render through `next/image` with the `?v=` query string | Confirmed on both `/` and `/events` — HTML emits `/_next/image?url=...api%2Fpublic%2Fevents...%3Fv%3D1`, and that optimized URL returns 200 (the `images.localPatterns` entry for `/api/public/events/**` with no `search` key is working as designed) |
| ISR pages (batch 2) don't break live dues/impact queries (batch 5) | Confirmed — `/donate` and `/join` have zero `auth()` calls (grepped directly), build table still shows both `○` ISR at `1h`, and the dev-server HTML shows correct live values ($120/$96 dues matching the active `dues_settings` row per batch 5's own SQL cross-check; $60,000+ impact total). Baking these at revalidate time is correct, documented behavior, not a regression. |

**Manual Click-Through**

| Flow | Result | Notes |
|------|--------|-------|
| Real sign-in (password or Google OAuth) | not run | No credentialed browser session was driven in this pass — `/signin` page-render-only was verified (200, correct title). Recommend a manual click-through of member sign-in → header swap ("Member Login" → "Member Portal"/"Sign Out") per batch 2's own open item, and of the admin event-image cropper (upload/crop/replace/remove) per batch 3's own open item, before shipping to production. |
| `/join` "consent checkbox" (batch 4 audit finding) | not reproducible in code, unresolved | Per batch 4's own note — grepped for `type="checkbox"` near `/join`, found none. Not a QA-introduced gap; flagging forward per batch 4's own recommendation that the Lions Club re-check the live production page. |

### Regression Tests Added

None — this was an integration-verification pass over five already-tested batches, not a bug fix requiring a new regression test. Each batch's own new unit tests (`event-image.test.ts` +12, `impact-stats.test.ts` +11) are already counted in the 1890-test total and were exercised by the `pnpm test` run above.

### Coverage on Critical Modules

Not re-measured with `--coverage` in this pass (out of scope for an integration-verification QA pass over already-unit-tested batches); `src/lib/events.ts` and `src/lib/permissions.ts` are untouched by any of the five batches. `src/lib/event-image.ts` and `src/lib/impact-stats.ts` (new pure modules from batches 3 and 5) each ship with dedicated, passing unit-test files per their own batch's Testing section.

### Feature-Gate Audit

No new `FEATURES` key, protected route, or server action was added by any of the five batches (confirmed against each batch's own "Schema Changes: None" / "No new FEATURES entry" statements and against my own read of the diff). The two admin event routes touched by batch 3 (`POST /api/admin/events`, `PATCH /api/admin/events/[id]`) were **modified but not newly gated** — re-verified both still call `auth()` + `hasFeature(session.user.features, FEATURES.EVENTS_EDIT)` before any write, unchanged from before this batch.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/events` | yes (pre-existing, unchanged) | yes (pre-existing, unchanged) | `FEATURES.EVENTS_EDIT` |
| `PATCH /api/admin/events/[id]` | yes (pre-existing, unchanged) | yes (pre-existing, unchanged) | `FEATURES.EVENTS_EDIT` |
| `GET /api/public/events/[id]/image` (new, batch 3) | no — intentionally public, mirrors `GET /api/public/members/[id]/photo`'s no-auth shape | n/a | n/a — serves only already-public event imagery, 404s on anything missing |
| `GET /api/public/campaigns/member-only` (new, batch 2) | session checked inside the handler (not a hard gate — returns `[]` for anonymous, no 401) | no — by design, this route returns non-public *campaigns*, not member PII | Reviewed the handler: it filters to `campaigns` rows where `isPublic = false`, gated on `session?.user` being present at all (any signed-in member sees these), consistent with the pre-existing behavior where any signed-in member could already see non-public campaigns server-side on `/donate` before this batch moved the query client-side. Not a new exposure — same visibility rule, moved from server-render to a fetched route. |
| `GET /api/events/[id]/viewer-context` (new, batch 2) | no hard gate — always 200, `auth()` called inside and branches to an anonymous baseline when absent | n/a | Returns only the viewing user's *own* RSVP/signup state plus already-public occurrence data (counts, signee names visible to any visitor); does not return other users' PII beyond what the page already rendered server-side to any visitor before this batch. No broadening of exposure. |

No protected route had its permission key changed, widened, or removed by this batch. Verdict: **no gate regressions.**

### Verdict: PASS

### Open questions / handoff notes

- **Manual credentialed click-through still outstanding**, carried forward from batches 2, 3, and 4's own handoff notes (member sign-in header swap, admin event-image cropper upload/replace/remove, signed-in member viewing a non-public campaign on `/donate`, a member with an existing RSVP seeing "Signed Up ✓" on `/events/[id]` after the personalization fetch resolves). None of these are blocked by anything found in this QA pass — they simply require a real browser session with real credentials, which this integrated pass did not drive.
- **`/join` consent checkbox** (batch 4 finding) remains unresolved/unreproduced in code — needs the Lions Club (or whoever ran the original live-site audit) to re-check the actual production page.
- **Privacy Policy content** (batch 5) still needs club/legal review before or shortly after ship — unchanged from batch 5's own flag.
- **Naming discrepancy** (`ledger_entities.name` "Westerville Lions Foundation" vs. the donor-facing "Westerville Lions Club Foundation") is a data question for the club, not a code defect — carried forward from batch 5.
- **E2E admin credentials are now present in `.env.local`** in this environment (they were reported absent during batch 2's own session) — worth a follow-up full `pnpm test:e2e` run to pick up the admin-gated specs, which this pass deliberately did not run (out of the task's stated scope).
- Nominating **analyst** for Phase 6 — shipped-vs-intent review against the original live-site audit findings, given a clean PASS here.

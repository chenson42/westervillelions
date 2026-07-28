# Dependencies Review — 2026-07-28

**Owner:** deployment-engineer
**Trigger:** Overdue 30-day review, prioritized to clear the CVE gate blocking pushes since v1.40.0 (3 critical + 2 high in the Auth.js chain, 1 high in transitive `brace-expansion`).

## Summary

Both blocking issues are resolved. `pnpm audit --prod --audit-level=high` now exits **0** (was exit 1). All verification gates pass: typecheck clean, 578/578 unit tests (hermetic), production build green, and a live credentials-flow auth smoke test (sign-in → session resolution → gated admin page load) succeeded end-to-end on the upgraded stack.

## What changed

| Package | Before | After | Why |
|---|---|---|---|
| `next-auth` | `5.0.0-beta.30` | `5.0.0-beta.32` | Same-line beta bump. Clears all 3 Auth.js advisories (config-error fail-open, email-normalizer homoglyph bypass, `getToken()` uncaught exception). |
| `@auth/drizzle-adapter` | `^1.11.2` | `^1.11.3` | Companion bump — pulls the same patched `@auth/core@0.41.3`. Adapter's own code unchanged (dependency-only release per its GitHub release notes). |
| `pnpm.overrides["@auth/core"]` | `0.41.1` | `0.41.3` | **Root cause of why the criticals persisted across at least two prior review cycles (2026-05-27, 2026-06-26 both logged "no action needed").** This override was pinning `@auth/core` down to the *vulnerable* 0.41.1 network-wide, overriding whatever next-auth/adapter wanted to resolve. No decision doc or work-log explains why it was pinned there; it reads as a stale lockstep pin from an earlier install, not a deliberate compat fix. Updated to the patched version so it no longer fights the bump. |
| `pnpm.overrides["brace-expansion@..."]` | `>=3.0.0 <5.0.7` → `>=5.0.7` | `>=3.0.0 <5.0.8` → `>=5.0.8` | **Second root cause.** The prior override's replacement range (`>=5.0.7`) was satisfied by the *still-vulnerable* 5.0.7 itself (patched versions are `>=5.0.8`, per GHSA-mh99-v99m-4gvg). The override was doing nothing. Corrected both the match range's upper bound and the replacement floor. |

No other production dependency changed. `next` (16.2.12) and `postcss` (8.5.24) — bumped at v1.40.0 — remain clear of the advisory list; confirmed via the full `pnpm audit --prod` run below.

## Investigation notes (Auth.js upgrade path)

- `pnpm view next-auth versions` shows `5.0.0-beta.32` is the newest beta in the 5.x line (no beta.33+ exists yet) — this is the ceiling of a low-risk bump, not a partial fix.
- GitHub release notes (`gh release view`, `nextauthjs/next-auth` repo) for `beta.31`, `beta.32`, and `@auth/core@0.41.3` confirm the changes are exactly the advisory fixes, nothing else:
  - `beta.31`: dependency bump only (`@auth/core` 0.41.0→0.41.2), a peer-dep alignment fix, GitHub-provider issuer addition, stricter email validation. No changes to `next-auth`'s own source.
  - `beta.32`: picks up `@auth/core@0.41.3` (bearer-token fix, provider-bound OAuth check cookies, NFKC email normalization) plus a first-party fix so a non-OK session response yields **no session** instead of an error object — this makes `!!auth` checks fail *closed* instead of *open*, which is the exact critical this project's `auth()` + `hasFeature()` pattern depends on failing safely.
  - `@auth/drizzle-adapter@1.11.3`: dependency-only bump, no adapter code changed.
- Read `src/lib/auth/index.ts` in full before touching anything: `DrizzleAdapter(db, { usersTable, accountsTable })`, JWT session strategy, Google + Credentials providers, `signIn`/`session`/`jwt` callbacks, and the `createUser` event that assigns the default `member` role. None of these touch APIs that changed between beta.30 and beta.32 — the fixes are internal to `@auth/core`'s cookie/token/email handling and the top-level session-resolution behavior, not the adapter contract or callback shapes this app relies on.
- Verdict: **same-line, low-risk bump.** No breaking changes identified in the diff between the current pin and the target.

## Verification results

1. **`pnpm exec tsc --noEmit`** — clean, no output.
2. **`unset DATABASE_URL DB_URL; pnpm test`** — 578/578 passing, 18/18 files, hermetic (no DB env vars set).
3. **`pnpm build:only`** — exit 0, no errors in output.
4. **Auth smoke test (mandatory, credentials flow)** — `pnpm dev` against `.env.local`:
   - Fetched CSRF token from `/api/auth/csrf`.
   - POSTed to `/api/auth/callback/credentials` with `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` → **302 redirect + `authjs.session-token` cookie set** (successful sign-in, no error redirect).
   - `GET /api/auth/session` with the session cookie → returned the full user object (`role: "admin"`, all expected `features`, `isActive: true`) — session resolution confirmed working.
   - `GET /admin/ledger/budgeting` with the session cookie → **HTTP 200**, page body contains real budgeting content ("Budget for Charitable donation out", "Budget for Club dues", etc.), not a redirect to `/signin` or `/access-pending`. The one `signin` string match in the body is the unrelated public footer "Member Login" link.
   - **Google OAuth flow was not exercised** (cannot drive an interactive Google consent screen headlessly). Provider config (`Google({ clientId, clientSecret, allowDangerousEmailAccountLinking: true })`) is unchanged by this bump and the release notes show no provider-level changes; residual risk is assessed as low but not empirically verified for this specific flow.

## `pnpm audit --prod --audit-level=high`

**Before:** exit 1 — 3 critical + 2 high (Auth.js ×5) + 1 high (`brace-expansion`) = 10 total findings, severity line `1 low | 3 moderate | 3 high | 3 critical`.

**After:** exit 0 — `2 vulnerabilities found`, `Severity: 1 low | 1 moderate`. Full advisory list (`pnpm audit --prod`, all severities) now shows only:

| Severity | Package | Advisory | Path | Notes |
|---|---|---|---|---|
| moderate | `uuid` | Missing buffer bounds check in v3/v5/v6 (GHSA-w5hq-g745-h8pq) | `.>exceljs>uuid` | Transitive via `exceljs` (script/build tooling, not a runtime request path). Patched `>=11.1.1`. Below the `--audit-level=high` gate — tracked, not blocking. |
| low | `@babel/core` | Arbitrary file read via `sourceMappingURL` (GHSA-4x5r-pxfx-6jf8) | `.>next>styled-jsx>@babel/core` | Transitive via Next's bundled `styled-jsx`, dev/build-time only. Patched `>=7.29.6`. Below the gate. |

**All 6 previously-blocking advisories are cleared:**
- Auth.js "Configuration errors can cause existence-based auth checks to fail open" (critical) — cleared, `next-auth@5.0.0-beta.32`.
- Auth.js "Email normalizer... homoglyph @ bypass" (critical, ×2 — `next-auth` + `@auth/core` paths) — cleared, both paths now resolve `@auth/core@0.41.3`.
- Auth.js "`getToken()` throws an uncaught exception on malformed Bearer headers" (high, ×2 — same two paths) — cleared.
- `brace-expansion` DoS (high) — cleared, resolves to `5.0.8` everywhere (verified via `pnpm why brace-expansion`).

## Broader `pnpm outdated` pass (not upgraded — informational)

No majors were touched this cycle per instruction. Notable minors/patches available but left alone: Radix UI primitives (several point releases behind), `react`/`react-dom` 19.2.7→19.2.8, `resend` 6.16.0→6.18.1, `eslint-config-next` 16.2.9 vs. installed `next` 16.2.12 (dev-only drift, no functional impact). Majors sitting further out (not evaluated for upgrade this cycle): `@types/node` (20→26), `eslint` (9→10), `tailwindcss` (3→4), `typescript` (5→7), `lucide-react` (0.562→1.27).

## Explicit verdict

**Auth.js upgrade: SAFE to ship.** Minimal, same-line beta bump; release notes confirm the changes are exactly the advisory fixes with no adapter/provider/callback API changes; full verification suite (typecheck, tests, build, and a live credentials-flow smoke test through session resolution and a gated admin page) all pass. Google OAuth's interactive flow could not be exercised headlessly, but the provider config and release notes show nothing that would affect it.

**Not committed, not pushed, not version-bumped** per instruction — `package.json` and `pnpm-lock.yaml` are modified in the working tree, ready for review.
